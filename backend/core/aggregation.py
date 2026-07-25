"""Precompute aggregates per (property, fiscal_period) and compose the caller's
dashboard by summing only their entitled cells. Refresh is on-write only."""
from collections import defaultdict
from decimal import Decimal

from django.core.cache import cache
from django.db.models import Count, Max, Min, Sum
from django.utils import timezone

from .models import (
    PENDING_STATUSES, STATUS_APPROVED, ApprovalEvent, Project, PropertyAggregate,
)
from .services import LEVEL_BY_STATUS

D0 = Decimal("0")


def refresh_property_period(org_id, property_id, fiscal_period):
    """Recompute the single aggregate cell affected by a write."""
    qs = Project.objects.filter(org_id=org_id, property_id=property_id,
                                fiscal_period=fiscal_period)
    totals = qs.aggregate(tb=Sum("budget_amount"), ta=Sum("actual_cost"), n=Count("id"))

    by_category = {}
    for row in qs.values("category").annotate(budget=Sum("budget_amount"),
                                              actual=Sum("actual_cost"), count=Count("id")):
        by_category[row["category"]] = {
            "budget": float(row["budget"] or 0), "actual": float(row["actual"] or 0),
            "count": row["count"],
        }
    by_status = {r["status"]: r["count"] for r in qs.values("status").annotate(count=Count("id"))}
    backlog = {s: by_status.get(s, 0) for s in PENDING_STATUSES}

    # Cycle time: submitted -> approved, from the audit log, for approved projects.
    cycle_sum, cycle_n = 0.0, 0
    approved_ids = list(qs.filter(status=STATUS_APPROVED).values_list("id", flat=True))
    if approved_ids:
        for s in (ApprovalEvent.objects.filter(project_id__in=approved_ids)
                  .values("project_id").annotate(start=Min("at"), end=Max("at"))):
            if s["start"] and s["end"] and s["end"] > s["start"]:
                cycle_sum += (s["end"] - s["start"]).total_seconds() / 3600.0
                cycle_n += 1

    PropertyAggregate.objects.update_or_create(
        property_id=property_id, fiscal_period=fiscal_period,
        defaults=dict(
            org_id=org_id, total_budget=totals["tb"] or D0, total_actual=totals["ta"] or D0,
            project_count=totals["n"] or 0,
            pending_count=qs.filter(status__in=PENDING_STATUSES).count(),
            by_category=by_category, by_status=by_status, backlog_by_level=backlog,
            cycle_time_sum_hours=cycle_sum, cycle_time_n=cycle_n, computed_at=timezone.now(),
        ),
    )
    bump_cache_version(org_id)


def recompute_all():
    """One-time bootstrap after a bulk load (the seed bypasses per-row signals)."""
    n = 0
    cells = (Project.objects.order_by().values_list("org_id", "property_id", "fiscal_period")
             .distinct())
    for org_id, property_id, fiscal_period in cells:
        refresh_property_period(org_id, property_id, fiscal_period)
        n += 1
    return n


# --- O(1) cache invalidation: dashboard keys embed the org's version ---------
def _ver_key(org_id):
    return f"dash:ver:{org_id}"


def get_cache_version(org_id):
    return cache.get_or_set(_ver_key(org_id), 1, None)


def bump_cache_version(org_id):
    try:
        cache.incr(_ver_key(org_id))
    except ValueError:
        cache.set(_ver_key(org_id), 2, None)


def build_dashboard(user, fiscal_period=None):
    """Sum the caller's entitled aggregate cells into the dashboard payload."""
    cells = PropertyAggregate.objects.for_user(user)
    if fiscal_period:
        cells = cells.filter(fiscal_period=fiscal_period)

    total_budget = total_actual = 0.0
    project_count = pending_count = 0
    cat = defaultdict(lambda: {"budget": 0.0, "actual": 0.0, "count": 0})
    status_counts = defaultdict(int)
    backlog = defaultdict(int)
    cycle_sum, cycle_n = 0.0, 0
    computed_at = None

    for c in cells:
        total_budget += float(c.total_budget)
        total_actual += float(c.total_actual)
        project_count += c.project_count
        pending_count += c.pending_count
        for k, v in (c.by_category or {}).items():
            cat[k]["budget"] += v.get("budget", 0.0)
            cat[k]["actual"] += v.get("actual", 0.0)
            cat[k]["count"] += v.get("count", 0)
        for s, n in (c.by_status or {}).items():
            status_counts[s] += n
        for lvl, n in (c.backlog_by_level or {}).items():
            backlog[lvl] += n
        cycle_sum += c.cycle_time_sum_hours
        cycle_n += c.cycle_time_n
        if computed_at is None or c.computed_at > computed_at:
            computed_at = c.computed_at

    variance = round((total_actual - total_budget) / total_budget * 100, 2) if total_budget else 0.0
    return {
        "generated_at": computed_at.isoformat() if computed_at else None,
        "kpis": {
            "total_budget": round(total_budget, 2), "total_actual": round(total_actual, 2),
            "variance_pct": variance, "project_count": project_count,
            "pending_approval": pending_count,
            "avg_cycle_time_hours": round(cycle_sum / cycle_n, 2) if cycle_n else 0.0,
        },
        "by_category": [
            {"category": k, "budget": round(v["budget"], 2), "actual": round(v["actual"], 2),
             "count": v["count"],
             "variance_pct": round((v["actual"] - v["budget"]) / v["budget"] * 100, 2)
             if v["budget"] else 0.0}
            for k, v in sorted(cat.items())
        ],
        "by_status": [{"status": s, "count": n} for s, n in sorted(status_counts.items())],
        "backlog_by_level": [
            {"level": lvl, "count": backlog[lvl]}
            for lvl in sorted(backlog, key=lambda s: LEVEL_BY_STATUS.get(s, 99))
        ],
    }
