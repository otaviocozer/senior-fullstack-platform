"""Keep aggregates fresh on project create/edit (approval transitions refresh
their own cell in services.py)."""
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .aggregation import bump_cache_version
from .models import Project


def _refresh(project):
    bump_cache_version(project.org_id)  # invalidate cached dashboards immediately
    try:
        from .tasks import refresh_property_period
        refresh_property_period.delay(project.org_id, project.property_id, project.fiscal_period)
    except Exception:
        # No broker (e.g. tests): compute synchronously.
        from .aggregation import refresh_property_period as sync_refresh
        sync_refresh(project.org_id, project.property_id, project.fiscal_period)


@receiver(post_save, sender=Project)
def project_saved(sender, instance, **kwargs):
    _refresh(instance)


@receiver(post_delete, sender=Project)
def project_deleted(sender, instance, **kwargs):
    _refresh(instance)
