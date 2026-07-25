from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health", lambda r: JsonResponse({"status": "ok"})),
    path("api/", include("core.urls")),
]
