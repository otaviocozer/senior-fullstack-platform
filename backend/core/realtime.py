"""WebSocket real-time: JWT auth middleware, a per-property-scoped consumer, and
the publisher. Clients only join the property groups they're entitled to, so a
broadcast to a property group can never leak to another tenant/property."""
from urllib.parse import parse_qs

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.layers import get_channel_layer
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from django.urls import path


def _group(property_id):
    return f"prop_{property_id}"


# --- auth middleware ---------------------------------------------------------
@database_sync_to_async
def _user_from_token(token):
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken
    from .models import User
    try:
        user_id = AccessToken(token)["user_id"]
        return User.objects.select_related("org").get(pk=user_id, is_active=True)
    except (TokenError, KeyError, User.DoesNotExist):
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        token = (parse_qs(scope.get("query_string", b"").decode()).get("token") or [None])[0]
        scope["user"] = await _user_from_token(token) if token else AnonymousUser()
        return await super().__call__(scope, receive, send)


# --- consumer ----------------------------------------------------------------
class DashboardConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if not getattr(user, "is_authenticated", False):
            await self.close(code=4401)
            return
        self.groups_joined = [_group(pid) for pid in await self._entitled(user)]
        for g in self.groups_joined:
            await self.channel_layer.group_add(g, self.channel_name)
        await self.accept()
        await self.send_json({"type": "connected", "properties": len(self.groups_joined)})

    async def disconnect(self, code):
        for g in getattr(self, "groups_joined", []):
            await self.channel_layer.group_discard(g, self.channel_name)

    async def approval_update(self, event):
        await self.send_json({"type": "approval.update", **event["payload"]})

    @database_sync_to_async
    def _entitled(self, user):
        return list(user.entitled_property_ids)


websocket_urlpatterns = [path("ws/dashboard/", DashboardConsumer.as_asgi())]


# --- publisher ---------------------------------------------------------------
def broadcast_approval_update(project):
    layer = get_channel_layer()
    if layer is None:
        return
    payload = {
        "project_id": project.id, "org_id": project.org_id,
        "property_id": project.property_id, "status": project.status,
        "fiscal_period": project.fiscal_period,
    }
    async_to_sync(layer.group_send)(
        _group(project.property_id), {"type": "approval.update", "payload": payload}
    )
