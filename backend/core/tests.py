from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from core.aggregation import build_dashboard, recompute_all, refresh_property_period
from core.models import ApprovalEvent, Organization, PENDING_STATUSES, Project, Property, User
from core.services import (
    InvalidTransition, PermissionDenied, next_status, perform_transition,
)


# --- helpers -----------------------------------------------------------------
def org(slug):
    return Organization.objects.create(name=slug.title(), slug=slug)


def prop(o, code):
    return Property.objects.create(org=o, code=code, name=f"Prop {code}")


def user(email, o, role, properties=()):
    u = User.objects.create_user(email=email, password="Passw0rd!", org=o, role=role)
    if properties:
        u.properties.set(properties)
    return u


def project(o, p, *, category="HVAC", period="FY2025", budget=1000, actual=500, status="draft"):
    return Project.objects.create(org=o, property=p, title="P", category=category,
                                  fiscal_period=period, budget_amount=budget, actual_cost=actual,
                                  status=status, created_at=timezone.now())


# --- authentication ----------------------------------------------------------
class AuthRequiredTests(APITestCase):
    def test_endpoints_require_authentication(self):
        # No token -> 401 on every data endpoint (login/refresh stay public).
        for url in ("/api/projects/", "/api/properties/", "/api/budgets/",
                    "/api/analytics/dashboard/", "/api/auth/me"):
            self.assertEqual(self.client.get(url).status_code, 401, url)


# --- cross-tenant RLS --------------------------------------------------------
class CrossTenantTests(APITestCase):
    def setUp(self):
        self.org1, self.org2 = org("org-001"), org("org-002")
        self.p1a, self.p1b = prop(self.org1, "P1A"), prop(self.org1, "P1B")
        self.p2 = prop(self.org2, "P2")
        self.pm = user("pm@org1", self.org1, "property_manager", [self.p1a])
        self.admin = user("admin@org1", self.org1, "org_admin")
        self.a = project(self.org1, self.p1a, budget=1000, actual=500)
        self.b = project(self.org1, self.p1b, budget=2000, actual=2500)
        self.foreign = project(self.org2, self.p2, budget=999, actual=999)

    def test_list_excludes_other_property_and_org(self):
        self.client.force_authenticate(self.pm)
        ids = {r["id"] for r in self.client.get("/api/projects/").data["results"]}
        self.assertEqual(ids, {self.a.id})

    def test_detail_out_of_scope_is_404(self):
        self.client.force_authenticate(self.pm)
        self.assertEqual(self.client.get(f"/api/projects/{self.b.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/projects/{self.foreign.id}/").status_code, 404)

    def test_admin_sees_whole_org_only(self):
        self.client.force_authenticate(self.admin)
        ids = {r["id"] for r in self.client.get("/api/projects/").data["results"]}
        self.assertEqual(ids, {self.a.id, self.b.id})
        self.assertEqual(self.client.get(f"/api/projects/{self.foreign.id}/").status_code, 404)

    def test_create_only_in_entitled_property(self):
        self.client.force_authenticate(self.pm)
        ok = self.client.post("/api/projects/", {
            "property_id": self.p1a.id, "title": "x", "category": "HVAC",
            "fiscal_period": "FY2025", "budget_amount": "100.00", "actual_cost": "0.00"})
        self.assertEqual(ok.status_code, 201)
        bad = self.client.post("/api/projects/", {
            "property_id": self.p1b.id, "title": "x", "category": "HVAC",
            "fiscal_period": "FY2025", "budget_amount": "100.00", "actual_cost": "0.00"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("property_id", bad.data)

    def test_analytics_scoped(self):
        recompute_all()
        self.client.force_authenticate(self.pm)
        self.assertEqual(self.client.get("/api/analytics/dashboard/").data["kpis"]["total_budget"],
                         1000.0)  # property A only
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/analytics/dashboard/").data["kpis"]["total_budget"],
                         3000.0)  # A + B, never org2


# --- state machine -----------------------------------------------------------
class StateMachineTests(APITestCase):
    def setUp(self):
        self.o = org("org-001")
        self.p = prop(self.o, "P1")
        self.pm = user("pm@o", self.o, "property_manager", [self.p])
        self.approver = user("ap@o", self.o, "approver", [self.p])
        self.viewer = user("vw@o", self.o, "viewer", [self.p])
        self.proj = project(self.o, self.p, status="draft")

    def test_transition_table(self):
        self.assertEqual(next_status("draft", "submit"), "submitted")
        self.assertEqual(next_status("finance_review", "approve"), "approved")
        for s in ("submitted", "manager_review", "finance_review"):
            self.assertEqual(next_status(s, "reject"), "rejected")
        with self.assertRaises(InvalidTransition):
            next_status("draft", "approve")   # can't skip levels
        with self.assertRaises(InvalidTransition):
            next_status("approved", "approve")  # terminal

    def test_happy_path_and_audit(self):
        p = perform_transition(project_id=self.proj.id, user=self.pm, action="submit")
        self.assertEqual(p.status, "submitted")
        for expected in ("manager_review", "finance_review", "approved"):
            p = perform_transition(project_id=self.proj.id, user=self.approver, action="approve")
            self.assertEqual(p.status, expected)
        self.assertEqual(ApprovalEvent.objects.filter(project=self.proj).count(), 4)

    def test_viewer_cannot_act(self):
        with self.assertRaises(PermissionDenied):
            perform_transition(project_id=self.proj.id, user=self.viewer, action="submit")

    def test_api_invalid_transition(self):
        self.client.force_authenticate(self.approver)
        # A draft can't be approved (must be submitted first) -> 400.
        self.assertEqual(self.client.post(f"/api/projects/{self.proj.id}/transition/",
                         {"action": "approve"}).status_code, 400)


# --- aggregation correctness -------------------------------------------------
class AggregationTests(APITestCase):
    def setUp(self):
        self.o = org("org-001")
        self.p1, self.p2 = prop(self.o, "P1"), prop(self.o, "P2")
        self.admin = user("admin@o", self.o, "org_admin")
        self.projects = [
            project(self.o, self.p1, category="HVAC", budget=1000, actual=1200, status="approved"),
            project(self.o, self.p1, category="HVAC", budget=500, actual=400, status="submitted"),
            project(self.o, self.p2, category="Roofing", budget=2000, actual=2000,
                    status="manager_review"),
            project(self.o, self.p2, category="Roofing", budget=800, actual=100, status="draft"),
        ]
        start = timezone.now() - timedelta(hours=20)
        ApprovalEvent.objects.create(org=self.o, property=self.p1, project=self.projects[0],
                                     to_status="submitted", at=start)
        ApprovalEvent.objects.create(org=self.o, property=self.p1, project=self.projects[0],
                                     to_status="approved", at=start + timedelta(hours=10))
        recompute_all()

    def test_kpis_match_ground_truth(self):
        k = build_dashboard(self.admin)["kpis"]
        self.assertEqual(k["total_budget"], 4300.0)
        self.assertEqual(k["total_actual"], 3700.0)
        self.assertEqual(k["project_count"], 4)
        self.assertEqual(k["pending_approval"],
                         sum(1 for p in self.projects if p.status in PENDING_STATUSES))
        self.assertEqual(k["avg_cycle_time_hours"], 10.0)

    def test_by_category(self):
        by_cat = {c["category"]: c for c in build_dashboard(self.admin)["by_category"]}
        self.assertEqual(by_cat["HVAC"]["budget"], 1500.0)
        self.assertEqual(by_cat["HVAC"]["count"], 2)
        self.assertEqual(by_cat["Roofing"]["budget"], 2800.0)

    def test_incremental_matches_full(self):
        p = self.projects[3]
        p.actual_cost = 700
        p.save(update_fields=["actual_cost"])
        refresh_property_period(p.org_id, p.property_id, p.fiscal_period)
        self.assertEqual(build_dashboard(self.admin)["kpis"]["total_actual"], 4300.0)
