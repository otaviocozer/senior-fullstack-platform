from django.core.cache import cache
from rest_framework import status as http_status
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .aggregation import build_dashboard, get_cache_version
from .models import Budget, Project, Property
from .rls import WRITE_ROLES
from .serializers import (
    BudgetSerializer, LoginSerializer, ProjectSerializer, PropertySerializer,
    TransitionSerializer, UserSerializer,
)
from .services import (
    ACTION_SUBMIT, InvalidTransition, PermissionDenied, perform_transition,
)


class Pagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 200


# --- auth --------------------------------------------------------------------
class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.validated_data)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


# --- projects ----------------------------------------------------------------
class ProjectViewSet(viewsets.ModelViewSet):
    """RLS is enforced centrally: every action starts from `for_user(user)`."""
    permission_classes = [IsAuthenticated]
    serializer_class = ProjectSerializer
    pagination_class = Pagination
    filterset_fields = ["status", "category", "fiscal_period", "property"]
    search_fields = ["title", "category"]

    def get_queryset(self):
        return Project.objects.for_user(self.request.user).select_related("property")

    def _require_write_role(self):
        if self.request.user.role not in WRITE_ROLES:
            self.permission_denied(self.request, message="Your role may not modify projects.")

    def create(self, request, *args, **kwargs):
        self._require_write_role()
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        self._require_write_role()
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._require_write_role()
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            project = perform_transition(
                project_id=pk, user=request.user,
                action=serializer.validated_data["action"],
            )
        except Project.DoesNotExist:
            return Response({"detail": "Not found."}, status=http_status.HTTP_404_NOT_FOUND)
        except PermissionDenied as e:
            return Response({"detail": str(e)}, status=http_status.HTTP_403_FORBIDDEN)
        except InvalidTransition as e:
            return Response({"detail": str(e)}, status=http_status.HTTP_400_BAD_REQUEST)

        return Response(ProjectSerializer(project, context={"request": request}).data)


class PropertyViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = PropertySerializer
    pagination_class = None  # small per-user list; frontend expects a plain array

    def get_queryset(self):
        return Property.objects.for_user(self.request.user)


class BudgetViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = BudgetSerializer

    def get_queryset(self):
        return Budget.objects.for_user(self.request.user)


# --- analytics ---------------------------------------------------------------
class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        period = request.query_params.get("fiscal_period") or None
        if period in ("", "all", "All"):
            period = None

        # Cache key reflects exactly what the caller may see; invalidated on write
        # by bumping the org's aggregate version.
        sig = ",".join(map(str, sorted(user.entitled_property_ids)))
        version = get_cache_version(user.org_id) if user.org_id else 0
        key = f"dash:{user.org_id}:{sig}:{period}:{version}"

        payload = cache.get(key)
        cache_hit = payload is not None
        if not cache_hit:
            payload = build_dashboard(user, period)
            cache.set(key, payload, timeout=300)
        # On-write refresh keeps served data current, so it's never stale.
        return Response({**payload, "stale": False, "cache_hit": cache_hit})
