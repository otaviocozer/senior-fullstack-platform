# Harness — Multi-Tenant CapEx Platform

`seed.py` generates a realistic, deterministic, **multi-tenant** dataset so your
authorization (row-level security) and analytics aggregation are tested against real
fan-out. It is **ORM-agnostic**: it emits JSON you load into *your* Django models however you
like (a management command, a fixture loader, `bulk_create`, etc.). Pure stdlib, no deps.

## Run

```bash
python seed.py --out ./seed_data
# or push one tenant large for perf testing your aggregation:
python seed.py --scale big --out ./seed_data
```

Defaults: 8 orgs, ~6,000 projects/org (org 1 ≈ 5× under `--scale big` → ~40k projects),
seed 42. Tune with `--orgs`, `--projects-per-org`, `--seed`.

## Output (`./seed_data/`)

| File | Contents |
|------|----------|
| `organizations.json` | tenants: `{id, name, slug}` |
| `properties.json` | `{id, org_id, name, code}` — each belongs to one org |
| `users.json` | `{id, org_id, email, role, property_ids, password}` |
| `budgets.json` | `{id, org_id, property_id, fiscal_period, allocated_amount}` |
| `projects.json` | `{id, org_id, property_id, title, category, fiscal_period, budget_amount, actual_cost, status, created_at}` |
| `approval_events.json` | `{id, project_id, org_id, property_id, to_status, at}` — lets you compute approval **cycle time** |
| `ENTITLEMENTS.md` | concrete "this user MUST NOT see this project" assertions → turn straight into authz tests |

All seeded users share the password `Passw0rd!` (plaintext in the file — hash it as your auth
expects).

## The authorization contract (this is what we test hardest)

| role | scope |
|------|-------|
| `org_admin` | the **entire org** (all its properties) — but **never** another org |
| `property_manager` | **only** the properties in their `property_ids`; full CRUD there |
| `approver` | **only** their `property_ids`; may act on approval levels |
| `viewer` | **only** their `property_ids`; read-only |

Crucial subtlety baked into the seed: `property_manager`/`approver`/`viewer` users are scoped
to a **subset** of their own org's properties. So tenant isolation is **two-level**:

1. A user must never see **another org's** data, and
2. A non-admin must never see **other properties within their own org** that aren't in their
   `property_ids`.

`ENTITLEMENTS.md` names specific project IDs each user must NOT be able to read — via list,
detail (by ID), **or** analytics aggregates. Wire those into your test suite.

## Status / approval flow

`projects.status ∈ {draft, submitted, manager_review, finance_review, approved, rejected}`.
The intended forward flow is `submitted → manager_review → finance_review → approved` (or
`rejected` at any level). `approval_events.json` contains the timestamped transitions so
"average approval cycle time" and "pending-approval backlog" are real, computable metrics for
your dashboard — and so your aggregation has something non-trivial to precompute.

## Why a "big tenant"

`--scale big` makes org 1 hold tens of thousands of projects. Point your analytics at it: a
live `GROUP BY` over that org on every dashboard load is exactly the anti-pattern this
assignment is meant to expose. Precompute/cache it.
