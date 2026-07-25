from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Budget, Project, Property
from .services import ACTIONS, LEVEL_BY_STATUS


class UserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    email = serializers.EmailField()
    role = serializers.CharField()
    org_id = serializers.IntegerField()
    org_name = serializers.SerializerMethodField()
    property_ids = serializers.SerializerMethodField()

    def get_org_name(self, obj):
        return obj.org.name if obj.org_id else None

    def get_property_ids(self, obj):
        return obj.entitled_property_ids


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        user = authenticate(username=attrs["email"], password=attrs["password"])
        if user is None or not user.is_active:
            raise serializers.ValidationError("Invalid email or password.")
        refresh = RefreshToken.for_user(user)
        return {"access": str(refresh.access_token), "refresh": str(refresh),
                "user": UserSerializer(user).data}


class PropertySerializer(serializers.ModelSerializer):
    org_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Property
        fields = ["id", "org_id", "name", "code"]


class ProjectSerializer(serializers.ModelSerializer):
    org_id = serializers.IntegerField(read_only=True)
    property_id = serializers.PrimaryKeyRelatedField(source="property",
                                                     queryset=Property.objects.all())
    property_name = serializers.CharField(source="property.name", read_only=True)
    variance_pct = serializers.SerializerMethodField()
    current_level = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["id", "org_id", "property_id", "property_name", "title", "category",
                  "fiscal_period", "budget_amount", "actual_cost", "status",
                  "variance_pct", "current_level", "created_at"]
        read_only_fields = ["status", "org_id", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # RLS on writes: you can only select a property you're entitled to.
        request = self.context.get("request")
        if request is not None and getattr(request.user, "is_authenticated", False):
            self.fields["property_id"].queryset = Property.objects.for_user(request.user)

    def get_variance_pct(self, obj):
        if not obj.budget_amount:
            return 0.0
        return round((float(obj.actual_cost) - float(obj.budget_amount))
                     / float(obj.budget_amount) * 100, 2)

    def get_current_level(self, obj):
        return LEVEL_BY_STATUS.get(obj.status)

    def validate_property_id(self, value):
        # Validator is named after the serializer field (property_id), not the source.
        user = self.context["request"].user
        if value.org_id != user.org_id or value.id not in set(user.entitled_property_ids):
            raise serializers.ValidationError("You are not entitled to this property.")
        return value

    def create(self, validated_data):
        validated_data["org_id"] = self.context["request"].user.org_id
        validated_data["created_at"] = timezone.now()
        validated_data["status"] = "draft"
        return super().create(validated_data)


class TransitionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=ACTIONS)


class BudgetSerializer(serializers.ModelSerializer):
    org_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Budget
        fields = ["id", "org_id", "property", "fiscal_period", "allocated_amount"]
