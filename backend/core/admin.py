from django.contrib import admin

from .models import ApprovalEvent, Budget, Organization, Project, Property, User

# All models except PropertyAggregate (derived analytics cache, not edited by hand).
admin.site.register([Organization, Property, User, Project, Budget, ApprovalEvent])
