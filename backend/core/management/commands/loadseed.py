"""Load the harness seed JSON, preserving ids, then build the aggregates.

    python manage.py loadseed --dir ../seed_data [--flush]
"""
import json
import os

from django.core.management.base import BaseCommand, CommandError
from django.core.management.color import no_style
from django.db import connection, transaction
from django.utils.dateparse import parse_datetime

from core.models import (
    ApprovalEvent, Budget, Organization, Project, Property, User,
)


def _read(d, name):
    with open(os.path.join(d, f"{name}.json"), encoding="utf-8") as f:
        return json.load(f)


class Command(BaseCommand):
    help = "Load the multi-tenant CapEx seed dataset."

    def add_arguments(self, parser):
        parser.add_argument("--dir", required=True)
        parser.add_argument("--flush", action="store_true")

    def handle(self, *args, **opts):
        d = opts["dir"]
        if not os.path.exists(os.path.join(d, "projects.json")):
            raise CommandError(f"No seed in {d}; run harness/seed.py first.")

        if opts["flush"]:
            ApprovalEvent.objects.all().delete()
            Project.objects.all().delete()
            Budget.objects.all().delete()
            User.objects.filter(is_superuser=False).delete()  # keep the admin superuser
            Property.objects.all().delete()
            Organization.objects.all().delete()
        elif Organization.objects.exists():
            self.stdout.write("Data already present; use --flush to reload. Skipping.")
            return

        with transaction.atomic():
            Organization.objects.bulk_create(
                [Organization(id=r["id"], name=r["name"], slug=r["slug"])
                 for r in _read(d, "organizations")])
            Property.objects.bulk_create(
                [Property(id=r["id"], org_id=r["org_id"], name=r["name"], code=r["code"])
                 for r in _read(d, "properties")], batch_size=5000)

            users = _read(d, "users")
            hasher = User(); hasher.set_password("Passw0rd!")  # hash the shared demo pw once
            User.objects.bulk_create(
                [User(id=r["id"], email=r["email"], org_id=r["org_id"], role=r["role"],
                      password=hasher.password, is_active=True,
                      is_staff=(r["role"] == "org_admin")) for r in users])
            Through = User.properties.through
            Through.objects.bulk_create(
                [Through(user_id=r["id"], property_id=pid)
                 for r in users for pid in r.get("property_ids", [])],
                batch_size=5000, ignore_conflicts=True)

            Budget.objects.bulk_create(
                [Budget(id=r["id"], org_id=r["org_id"], property_id=r["property_id"],
                        fiscal_period=r["fiscal_period"], allocated_amount=r["allocated_amount"])
                 for r in _read(d, "budgets")], batch_size=5000)
            Project.objects.bulk_create(
                (Project(id=r["id"], org_id=r["org_id"], property_id=r["property_id"],
                         title=r["title"], category=r["category"], fiscal_period=r["fiscal_period"],
                         budget_amount=r["budget_amount"], actual_cost=r["actual_cost"],
                         status=r["status"], created_at=parse_datetime(r["created_at"]))
                 for r in _read(d, "projects")), batch_size=5000)
            ApprovalEvent.objects.bulk_create(
                (ApprovalEvent(id=r["id"], org_id=r["org_id"], property_id=r["property_id"],
                               project_id=r["project_id"], to_status=r["to_status"],
                               at=parse_datetime(r["at"]))
                 for r in _read(d, "approval_events")), batch_size=5000)

            # bulk_create with explicit ids doesn't advance PG sequences; fix them.
            sql = connection.ops.sequence_reset_sql(
                no_style(), [Organization, Property, User, Budget, Project, ApprovalEvent])
            with connection.cursor() as cur:
                for stmt in sql:
                    cur.execute(stmt)

        self.stdout.write("Computing aggregates...")
        from core.aggregation import recompute_all
        self.stdout.write(self.style.SUCCESS(f"Done. {recompute_all()} aggregate cells."))
