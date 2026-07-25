"""Create the Django admin superuser as part of migrations (idempotent).

Credentials come from DJANGO_SUPERUSER_EMAIL / DJANGO_SUPERUSER_PASSWORD
(default: admin / admin). A high, fixed id is used so it never collides with the
seed's explicit user ids (loadseed inserts users 1..N)."""
import os

from django.contrib.auth.hashers import make_password
from django.db import migrations

ADMIN_ID = 100000


def create_admin(apps, schema_editor):
    User = apps.get_model("core", "User")
    email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "admin")
    password = os.environ.get("DJANGO_SUPERUSER_PASSWORD", "admin")
    if User.objects.filter(email=email).exists():
        return
    User.objects.create(
        id=ADMIN_ID, email=email, password=make_password(password),
        role="org_admin", is_staff=True, is_superuser=True, is_active=True, org=None,
    )


def remove_admin(apps, schema_editor):
    User = apps.get_model("core", "User")
    User.objects.filter(id=ADMIN_ID).delete()


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]
    operations = [migrations.RunPython(create_admin, remove_admin)]
