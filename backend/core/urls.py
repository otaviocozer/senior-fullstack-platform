from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    BudgetViewSet, DashboardView, LoginView, MeView, ProjectViewSet, PropertyViewSet,
)

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("properties", PropertyViewSet, basename="property")
router.register("budgets", BudgetViewSet, basename="budget")

urlpatterns = [
    path("auth/login", LoginView.as_view(), name="auth-login"),
    path("auth/refresh", TokenRefreshView.as_view(), name="auth-refresh"),
    path("auth/me", MeView.as_view(), name="auth-me"),
    path("analytics/dashboard/", DashboardView.as_view(), name="analytics-dashboard"),
    path("", include(router.urls)),
]
