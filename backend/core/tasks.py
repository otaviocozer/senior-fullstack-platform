from celery import shared_task

from . import aggregation


@shared_task(name="core.refresh_property_period")
def refresh_property_period(org_id, property_id, fiscal_period):
    """Incrementally refresh one aggregate cell (enqueued on project writes)."""
    aggregation.refresh_property_period(org_id, property_id, fiscal_period)
