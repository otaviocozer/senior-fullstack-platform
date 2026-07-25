# Entitlement assertions (use these as authz test cases)

These are guaranteed by the seed. Each should return 403/404 (your choice),
NOT the row, when accessed by the named user.

- User `pm2@org1.example.com` (property_manager, org 1, properties [5]):
    - MUST NOT see project id 1 (same org, property 3 not in their scope).
    - MUST NOT see project id 6001 (different org 2).
    - MUST NOT see those projects in list endpoints OR in analytics totals.
- User `admin1@org1.example.com` (org_admin, org 1): MUST NOT see project id 6001 (different org 2).

## Role matrix

| role | scope |
|------|-------|
| org_admin | entire org (all its properties); never another org |
| property_manager | only properties in their `property_ids`; full CRUD there |
| approver | only their `property_ids`; may act on approval levels |
| viewer | only their `property_ids`; read-only |
