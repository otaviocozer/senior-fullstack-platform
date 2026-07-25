"""Approval state machine + the concurrency-safe transition service."""
from django.db import transaction
from django.utils import timezone

from .models import (
    STATUS_APPROVED, STATUS_DRAFT, STATUS_FINANCE_REVIEW, STATUS_MANAGER_REVIEW,
    STATUS_REJECTED, STATUS_SUBMITTED, ApprovalEvent, Project,
)
from .rls import APPROVAL_ROLES, WRITE_ROLES

ACTION_SUBMIT, ACTION_APPROVE, ACTION_REJECT = "submit", "approve", "reject"
ACTIONS = (ACTION_SUBMIT, ACTION_APPROVE, ACTION_REJECT)

# (status, action) -> next status. Missing entries are illegal transitions.
TRANSITIONS = {
    (STATUS_DRAFT, ACTION_SUBMIT): STATUS_SUBMITTED,
    (STATUS_SUBMITTED, ACTION_APPROVE): STATUS_MANAGER_REVIEW,
    (STATUS_SUBMITTED, ACTION_REJECT): STATUS_REJECTED,
    (STATUS_MANAGER_REVIEW, ACTION_APPROVE): STATUS_FINANCE_REVIEW,
    (STATUS_MANAGER_REVIEW, ACTION_REJECT): STATUS_REJECTED,
    (STATUS_FINANCE_REVIEW, ACTION_APPROVE): STATUS_APPROVED,
    (STATUS_FINANCE_REVIEW, ACTION_REJECT): STATUS_REJECTED,
}
LEVEL_BY_STATUS = {STATUS_SUBMITTED: 1, STATUS_MANAGER_REVIEW: 2, STATUS_FINANCE_REVIEW: 3}


class InvalidTransition(Exception):
    pass


class PermissionDenied(Exception):
    pass


def next_status(current, action):
    try:
        return TRANSITIONS[(current, action)]
    except KeyError:
        raise InvalidTransition(f"Cannot '{action}' a project in status '{current}'.")


@transaction.atomic
def perform_transition(*, project_id, user, action):
    # Lock the row (serializes concurrent approvers -> no lost updates) and scope
    # by user, so out-of-tenant ids look "not found".
    project = Project.objects.for_user(user).select_for_update().get(pk=project_id)

    if action == ACTION_SUBMIT and user.role not in WRITE_ROLES:
        raise PermissionDenied("Your role may not submit projects.")
    if action != ACTION_SUBMIT and user.role not in APPROVAL_ROLES:
        raise PermissionDenied("Your role may not act on approvals.")

    new_status = next_status(project.status, action)  # raises InvalidTransition
    project.status = new_status
    if action == ACTION_SUBMIT and project.submitted_by_id is None:
        project.submitted_by = user
    project.save(update_fields=["status", "submitted_by", "updated_at"])

    ApprovalEvent.objects.create(
        org_id=project.org_id, property_id=project.property_id, project=project,
        to_status=new_status, actor=user, at=timezone.now(),
    )

    # Refresh the affected aggregate cell + broadcast, after the tx commits.
    def _after_commit():
        from .aggregation import refresh_property_period
        from .realtime import broadcast_approval_update
        refresh_property_period(project.org_id, project.property_id, project.fiscal_period)
        broadcast_approval_update(project)

    transaction.on_commit(_after_commit)
    return project
