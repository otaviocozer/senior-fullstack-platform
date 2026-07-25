"""Central row-level security. `scope_to_user` is the single place tenant +
property scoping is decided; every tenant-owned model exposes `.for_user()`."""
from django.db import models

ROLE_ORG_ADMIN = "org_admin"
ROLE_PROPERTY_MANAGER = "property_manager"
ROLE_APPROVER = "approver"
ROLE_VIEWER = "viewer"

# Roles allowed to mutate projects / act on approvals.
WRITE_ROLES = {ROLE_ORG_ADMIN, ROLE_PROPERTY_MANAGER}
APPROVAL_ROLES = {ROLE_ORG_ADMIN, ROLE_PROPERTY_MANAGER, ROLE_APPROVER}


def scope_to_user(queryset, user, *, property_field="property_id"):
    """Narrow `queryset` to rows `user` may access: their own org, and — unless
    they are an org_admin — only their entitled properties."""
    if not getattr(user, "is_authenticated", False) or user.org_id is None:
        return queryset.none()
    queryset = queryset.filter(org_id=user.org_id)
    if user.role == ROLE_ORG_ADMIN:
        return queryset
    return queryset.filter(**{f"{property_field}__in": user.entitled_property_ids})


class TenantQuerySet(models.QuerySet):
    property_field = "property_id"

    def for_user(self, user):
        return scope_to_user(self, user, property_field=self.property_field)


class TenantManager(models.Manager.from_queryset(TenantQuerySet)):
    pass


class PropertyQuerySet(TenantQuerySet):
    # A property is scoped by its own id.
    property_field = "id"


class PropertyManager(models.Manager.from_queryset(PropertyQuerySet)):
    pass
