from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models

from .rls import ROLE_ORG_ADMIN, PropertyManager, TenantManager

# Approval state machine statuses.
STATUS_DRAFT = "draft"
STATUS_SUBMITTED = "submitted"
STATUS_MANAGER_REVIEW = "manager_review"
STATUS_FINANCE_REVIEW = "finance_review"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_CHOICES = [
    (STATUS_DRAFT, "Draft"), (STATUS_SUBMITTED, "Submitted"),
    (STATUS_MANAGER_REVIEW, "Manager Review"), (STATUS_FINANCE_REVIEW, "Finance Review"),
    (STATUS_APPROVED, "Approved"), (STATUS_REJECTED, "Rejected"),
]
PENDING_STATUSES = (STATUS_SUBMITTED, STATUS_MANAGER_REVIEW, STATUS_FINANCE_REVIEW)


class Organization(models.Model):
    """A tenant."""
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=64, unique=True)

    def __str__(self):
        return self.name


class Property(models.Model):
    """A sub-unit (building/hotel) inside an org; users are scoped to properties."""
    org = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="properties")
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=32)

    objects = PropertyManager()

    class Meta:
        verbose_name_plural = "properties"

    def __str__(self):
        return f"{self.code} · {self.name}"


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.update(is_staff=True, is_superuser=True)
        extra.setdefault("role", ROLE_ORG_ADMIN)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Identity + tenant + role + property entitlements (the source of truth for
    RLS — never trusted from the JWT)."""
    ROLE_CHOICES = [
        ("org_admin", "Org Admin"), ("property_manager", "Property Manager"),
        ("approver", "Approver"), ("viewer", "Viewer"),
    ]
    email = models.EmailField(unique=True)
    org = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="users",
                            null=True, blank=True)
    role = models.CharField(max_length=32, choices=ROLE_CHOICES, default="viewer")
    properties = models.ManyToManyField(Property, blank=True, related_name="entitled_users")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    def __str__(self):
        return self.email

    @property
    def entitled_property_ids(self):
        """org_admin -> every property in the org; others -> their explicit subset."""
        if not hasattr(self, "_prop_ids"):
            qs = Property.objects.filter(org_id=self.org_id)
            if self.role != ROLE_ORG_ADMIN:
                qs = qs.filter(entitled_users=self)
            self._prop_ids = list(qs.values_list("id", flat=True))
        return self._prop_ids


class Project(models.Model):
    """A CapEx spending request (the harness `projects.json` shape)."""
    org = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="projects")
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="projects")
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=64)
    fiscal_period = models.CharField(max_length=16)
    budget_amount = models.DecimalField(max_digits=14, decimal_places=2)
    actual_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    submitted_by = models.ForeignKey("User", on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="submitted_projects")
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)

    objects = TenantManager()

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["org", "property", "fiscal_period"]),
            models.Index(fields=["org", "status"]),
            models.Index(fields=["org", "category"]),
        ]

    def __str__(self):
        return f"#{self.pk} {self.title} [{self.status}]"


class Budget(models.Model):
    org = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="budgets")
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="budgets")
    fiscal_period = models.CharField(max_length=16)
    allocated_amount = models.DecimalField(max_digits=14, decimal_places=2)

    objects = TenantManager()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["property", "fiscal_period"],
                                               name="uniq_budget_per_property_period")]


class ApprovalEvent(models.Model):
    """Append-only audit trail of transitions (feeds the cycle-time metric)."""
    org = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="approval_events")
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="approval_events")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="approval_events")
    to_status = models.CharField(max_length=32, choices=STATUS_CHOICES)
    actor = models.ForeignKey("User", on_delete=models.SET_NULL, null=True, blank=True)
    at = models.DateTimeField()

    objects = TenantManager()

    class Meta:
        indexes = [models.Index(fields=["org", "project"])]


class PropertyAggregate(models.Model):
    """Precomputed rollup per (property, fiscal_period). The dashboard sums the
    caller's entitled cells instead of scanning millions of project rows."""
    org = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="aggregates")
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="aggregates")
    fiscal_period = models.CharField(max_length=16)
    total_budget = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_actual = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    project_count = models.PositiveIntegerField(default=0)
    pending_count = models.PositiveIntegerField(default=0)
    by_category = models.JSONField(default=dict)
    by_status = models.JSONField(default=dict)
    backlog_by_level = models.JSONField(default=dict)
    cycle_time_sum_hours = models.FloatField(default=0.0)
    cycle_time_n = models.PositiveIntegerField(default=0)
    computed_at = models.DateTimeField()

    objects = TenantManager()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["property", "fiscal_period"],
                                               name="uniq_prop_agg")]
