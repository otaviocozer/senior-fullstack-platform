## 1. Architecture & the path of a request

```
                         ┌──────────────────────────────────────────┐
   Browser (React SPA)   │                 API tier                  │
   ┌───────────────┐     │  Daphne (ASGI) ── DRF / Channels          │
   │ RTK Query     │─────┼─▶ 1. JWTAuthentication resolves the user  │
   │ MUI dashboard │ HTTP│     from the DB (role + entitlements are   │
   │ WS client     │     │     NOT trusted from the token payload)    │
   └───────┬───────┘     │  2. Base viewset builds the queryset as    │
           │             │     Model.objects.for_user(request.user)   │  ← RLS
           │ WS          │  3. Reads: analytics endpoint serves        │
           │             │     precomputed cells (cache → DB)          │
           ▼             │  4. Writes: transition service (locking +   │
   ┌───────────────┐     │     state-machine check) → audit event      │
   │ Channels      │◄────┼── 5. post-commit: refresh aggregate cell +  │
   │ consumer      │     │     broadcast to the property's group        │
   └───────────────┘     └───────────────┬──────────────────────────┘
                                          │
        Redis ◀── cache + channel-layer + Celery broker ──┐
        Postgres ◀── OLTP rows + precomputed PropertyAggregate cells
        Celery worker ── incremental refresh of the affected cell (on write only)
```

**Read path (dashboard):** `GET /api/analytics/dashboard/` → JWT auth → build a
cache key from `(org, entitled-property-signature, period, agg-version)` → Redis
hit returns in ~1ms; miss sums the caller's precomputed `PropertyAggregate` cells
(a few hundred rows) and caches it.

**Write path (approval):** `POST /api/projects/{id}/transition/` → JWT auth →
`for_user` queryset + `select_for_update` locks the row → state-machine validates
the transition → save + append `ApprovalEvent` →
**on commit**: refresh the one affected aggregate cell (async) and broadcast to
the property's WebSocket group.

---

## 2. Authorization model & enforcement

### The rule

Two-level tenancy (from the harness contract):

| role | scope |
|------|-------|
| `org_admin` | the entire org (all its properties), never another org |
| `property_manager` | only properties in their `property_ids`; full CRUD there |
| `approver` | only their `property_ids`; may act on approvals |
| `viewer` | only their `property_ids`; read-only |

So isolation must hold **across orgs** *and* **across properties within an org**.

### Enforced centrally, so no endpoint can forget it

There is exactly **one** function that decides scope — `core/rls.py::scope_to_user`:

```python
qs = qs.filter(org_id=user.org_id)               # never cross-org
if user.role == "org_admin": return qs           # whole org
return qs.filter(property_id__in=user.entitled_property_ids)   # subset only
```

Every tenant-owned model uses a `TenantManager` exposing `.for_user(user)`, and
every viewset's `get_queryset` derives its queryset from it:

```python
def get_queryset(self):
    return Project.objects.for_user(self.request.user)
```

Because list, retrieve, update, and destroy all start from the scoped queryset,
a developer cannot add an endpoint that "forgets" RLS — the scoped queryset *is*
the scope. Writes get a second, explicit check: the serializer re-validates that
the target `property` is in the caller's entitlements (so you can't create/move a
project into a property you don't own), and role gates (`WRITE_ROLES`,
`APPROVAL_ROLES`) block viewers.

Crucially, **analytics is scoped by the same mechanism**. Aggregates are stored
per property, and the dashboard reads `PropertyAggregate.objects.for_user(user)`,
so a property_manager's totals sum only their properties' cells — the aggregate
path cannot leak what the list path hides.

### Threat model — how Property B stays invisible

- **List** — the base queryset filters it out.
- **Detail by id** — the row is absent from `for_user(user)`, so `.get(pk=...)`
  raises `DoesNotExist` → **404**.
- **Analytics** — only entitled cells are summed; B never contributes.
- **Export** (when added) — must reuse `for_user`; the base queryset makes that
  the path of least resistance.
- **ID guessing** — same as detail: absent ⇒ 404.
- **Token tampering** — role and `property_ids` are read from the DB per request,
  never from the JWT claims, so forging claims changes nothing.
- **WebSocket** — a client is only subscribed to its entitled property groups
  (§4), so it cannot receive another property's events even if it guesses a group.

### 403 vs 404 — and why 404

For a row outside the caller's scope we return **404**, not 403. A 403 confirms
"this id exists but isn't yours," leaking existence and enabling enumeration of a
competitor's project-id space. 404 is indistinguishable from "no such id." We
reserve **403** for *in-scope* actions the role may not perform (e.g. a viewer
trying to approve a project they *can* see) — there, hiding existence buys nothing
and a clear "not allowed" is better UX. This split falls out naturally: scoping is
enforced in the queryset (absence ⇒ 404), role/permission is a separate check
(⇒ 403).

### How roles compose

Role is a single enum per user plus a property-id set. `org_admin` short-circuits
to the whole org; everyone else is `property_id ∈ entitlements`. Adding a role is
adding one branch in `scope_to_user` and (optionally) a membership in the write
/approval role sets — no per-view changes. Entitlements are resolved once per
request and memoized on the user instance.

---

## 3. Analytics at scale

### The anti-pattern we avoid

A dashboard that runs `GROUP BY category/status` plus cycle-time joins over an
org's tens of thousands of projects **on every request** does megabytes of I/O per
hit and collapses under a big tenant. We never do this on the request path.

### Precompute at (property, fiscal_period) granularity

A Celery job computes, per `(property, fiscal_period)` cell, a `PropertyAggregate`
row holding: total budget, total actual, project count, pending count, and JSON
breakdowns `by_category` / `by_status` / `backlog_by_level`, plus cycle-time
accumulators (`sum_hours`, `n`). The dashboard endpoint then just **sums the cells
the caller is entitled to** and derives variance % and average cycle time.

Why this granularity (not a single per-org row)? Three properties fall out of it:

1. **RLS composes for free** — a property_manager sums only their cells; an
   org_admin sums all of the org's. No separate "aggregate authz."
2. **Incremental updates are cheap** — a write touches exactly one cell
   `(its property, its period)`; we recompute just that one, not the org.
3. **Cells are summable** — cycle time is stored as `(sum, n)` rather than an
   average precisely so partial rollups add correctly.

Read cost is O(number of entitled cells) = properties × periods ≈ a few hundred
rows even for the biggest org — bounded and tiny, independent of project volume.

### Where aggregates live, and caching

- **Source of truth:** the `PropertyAggregate` table in Postgres (durable,
  queryable, survives a Redis flush).
- **Hot cache:** the fully-composed dashboard payload in Redis, keyed by
  `(org, sorted entitled property ids, period, agg-version)` with a short TTL.

**Invalidation is O(1) via a version bump.** Each org has an integer
`dash:ver:{org}` in Redis embedded in every dashboard cache key. Any write to
the org calls `bump_cache_version(org)` (`INCR`), which makes all previously cached
payloads for that org unreachable instantly — no key scanning, no per-key deletes.
The next read recomputes from the (already refreshed) cells and re-caches.

### Refresh strategy: incremental, on write only

The assignment asks for one refresh/invalidation strategy — *on write? on schedule?
incremental?* — chosen and defended. **We chose incremental refresh on write, and
no scheduled recompute.**

- **On every write**, two things happen: (a) the cache version is bumped
  *synchronously* (`INCR`), so every cached dashboard for the org is immediately
  invalidated; (b) `refresh_property_period(org, property, period)` recomputes the
  *single* affected cell. The **approval path refreshes the cell synchronously**
  (in `transaction.on_commit`), so a dashboard read right after an approval already
  sees the new numbers. **Project create/edit** enqueues the cell refresh on the
  Celery worker to keep the write request fast.
- **Bulk loads** (the seed loader) bypass per-row signals, so aggregates are
  built once via `recompute_all()` at load time. That is a one-time bootstrap, not
  a schedule.

**Why on-write over on-schedule.** On-write gives the freshest possible dashboard
(no fixed lag window) and does the least work — one cell per write, versus a cron
job that periodically rescans every org whether or not anything changed. At
5M projects a scheduled full recompute is expensive and mostly redundant. The cost
we accept is discussed under the tradeoff below.

**Staleness window.** With cache invalidation on write, a served payload always
reflects committed writes, so the endpoint returns `stale: false` and uses
`generated_at` to show "data as of the last change." The only lag is the
sub-second async cell refresh for create/edit (the approval path has none because
it refreshes synchronously). We deliberately do **not** run a scheduled reconcile;
see the concurrency section and tradeoff #1 for how we keep this correct without one.

### Latencies

- **First load (cache miss):** sum a few hundred cell rows + JSON merge ≈ 5–30 ms.
- **Steady state (cache hit):** one Redis GET ≈ 1–3 ms.
- **Cell refresh after a write:** a handful of indexed aggregate queries scoped to
  one property+period (thousands of rows, not millions), off the request path.

---

## 4. Real-time delivery at scale

**Transport:** Django Channels (WebSocket) over a Redis channel layer. The browser
cannot set an `Authorization` header on a WebSocket, so the access token is passed
as `?token=...` and validated by `core/realtime.py`, which attaches the real
DB user to the connection scope.

**Tenant-scoped fan-out without leakage:** on connect, a client joins **only the
`prop_<id>` groups it is entitled to** (an org_admin → all org properties; others
→ their subset). Approval events are published to the *specific property's* group
(`core/realtime.py`). Therefore a client can only ever receive events for
properties it can already see — **there is no org-wide broadcast channel to leak
from**, and group membership is derived from server-side entitlements, not client
input.

**Fan-out cost & 10k concurrent sockets:** a transition publishes one message to
one property group; Redis delivers it only to that group's members (typically a
handful). Cost scales with *interested* subscribers per property, not total
sockets. At 10k concurrent dashboards you run multiple Daphne/ASGI replicas behind
a WS-aware load balancer sharing one Redis channel layer (or Redis Cluster);
because messages are keyed by property group, cross-node fan-out stays targeted.
The payload is a small delta (`project_id, status, property_id, …`); the client patches
its cache and invalidates analytics rather than the server pushing full snapshots.

**Delivery semantics:** WebSocket is best-effort (at-most-once). The UI treats
real-time as an *accelerator*, not the source of truth — RTK Query still holds the
authoritative state, and a reconnect re-fetches, so a dropped event self-heals on
the next poll/refresh. (SSE or short-poll would also satisfy the requirement;
Channels was chosen because bidirectional sockets + Redis groups give the cleanest
tenant-scoped fan-out and reuse the Redis we already run.)

---

## 5. Concurrency & correctness

**Two approvers act on the same project at once.** The transition runs in a
transaction and takes `select_for_update()` on the project row, serializing the two
actors. The first advances `submitted → manager_review` and commits; the second,
which was blocked on the row lock, only then reads the row — now in the new state —
so its requested transition is re-evaluated against the current status and the
state machine rejects an illegal move (e.g. a second `submit`, or approving past
the level). The lock is what guarantees no lost update, no double-advance, and no
skipped level: the two writes are strictly ordered, never interleaved.

**A cell refresh runs while writes land.** Aggregates are derived data, never
authoritative, so a race can at worst produce a briefly stale cell — never a wrong
OLTP row. Safeguards: the refresh + cache-version bump happen *after commit*
(`transaction.on_commit`), so a refresh never reads a half-applied write; and cell
writes are **idempotent `update_or_create` upserts** keyed by `(property, period)`
that recompute the cell from the current rows, so overlapping refreshes for the
same cell converge on the same result rather than corrupt it — the last writer
simply recomputes the truth. Because we run no scheduled reconcile (this is a pure
on-write strategy), the durability of a refresh matters: the approval path
refreshes synchronously on commit, and the async create/edit refresh runs on the
worker with Celery's `acks_late`-style retry semantics. A permanently lost refresh
would leave one cell stale until the next write to that property+period; the
correctness cost of that choice is called out in tradeoff #1.

**Audit integrity.** `ApprovalEvent` rows are append-only and written in the same
transaction as the status change, so the audit log and the project state can never
disagree; cycle time is computed from these timestamps.

---

## 6. Production DB & deployment (Azure SQL + AKS)

The slice uses Postgres (SQLite for tests). Moving to **Azure SQL** on **AKS**:

- **Driver/engine:** swap `psycopg` for `mssql-django` + ODBC Driver 18. The ORM
  usage here is portable (no Postgres-only SQL); `JSONField` maps to `nvarchar(max)`
  on Azure SQL — fine for our small breakdown blobs, though if we needed to query
  *inside* them at scale we'd promote hot dimensions to real columns/tables.
- **Migrations:** run as a Kubernetes **Job** (or an init container gated by a
  leader) rather than in every pod's entrypoint, so N replicas don't race. The
  compose entrypoint's "only the api migrates" rule generalizes to "one migration
  Job per release."
- **Connection pooling:** Azure SQL caps connections and each pod holds its own,
  so put **PgBouncer-equivalent pooling** in front — for Azure SQL that's a proxy
  like **Azure SQL's built-in pooling** plus app-side limits, or route through a
  sidecar; keep Django `CONN_MAX_AGE` modest and cap Gunicorn/Daphne workers so
  `replicas × workers × conns` stays under the tier limit.
- **Read replicas:** point the analytics/dashboard reads and the aggregation
  worker's scans at a **read replica / geo-secondary** via a Django database
  router (writes + the approval `select_for_update` stay on primary). This keeps
  heavy aggregate scans off the OLTP primary.
- **Indexing for the aggregates.** The cell refresh filters
  `(org_id, property_id, fiscal_period)` and groups by category/status, so a
  composite index on `(org_id, property_id, fiscal_period)` (plus `(org_id, status)`
  and `(org_id, category)`) keeps each refresh scanning only one property+period's
  slice rather than the whole table. These are declared in
  `core/models.py::Meta.indexes` and carry over unchanged to Azure SQL.
- **Deployment topology:** separate Deployments for `api` (Daphne, HPA on CPU/RPS)
  and `worker` (HPA on queue depth — it only does on-write cell refreshes, so it
  scales horizontally with no singleton constraint), a managed **Azure Cache for
  Redis** for cache + channel layer + broker, and the frontend served as static
  assets from a CDN (build `npm run build`, drop `dist/` behind Nginx/Front Door)
  instead of the dev server used in compose. *(If we later wanted a periodic
  reconcile as defense-in-depth, that would add a single-replica `beat` — but the
  chosen on-write strategy runs without one.)*

---

## 7. The three biggest tradeoffs

1. **Precompute + refresh-on-write vs. compute-on-demand (and vs. scheduled recompute).**
   *Chose:* precomputed per-property cells, refreshed incrementally **on write**,
   summed at read time and Redis-cached; **no scheduled recompute**.
   *Gave up:* two things. First, vs. compute-on-demand — we carry an extra table +
   worker and the create/edit path has a sub-second async refresh lag. Second, vs.
   a scheduled reconcile — we give up an automatic safety net, so a permanently
   lost refresh task leaves one cell stale until the next write to that
   property+period. *Why:* the read path must be O(hundreds of rows) regardless of
   the 5M-row total, which rules out compute-on-demand; and on-write beats a cron
   recompute on both freshness (no fixed lag window) and cost (one cell per change
   vs. periodically rescanning every org whether or not it changed — wasteful at
   5M rows). We mitigate the lost-refresh risk with synchronous refresh on the
   approval path, idempotent upserts, and worker retries; if audits later showed
   drift, adding a low-frequency reconcile job is a small, isolated change (§6).

2. **Enforce RLS in the ORM/queryset layer vs. in the database (real RLS policies).**
   *Chose:* a single application-layer `for_user` behind a base queryset.
   *Gave up:* defense-in-depth if someone bypasses the ORM with raw SQL, and
   DB-native `SESSION_CONTEXT`/RLS policies. *Why:* it's centralized, testable,
   portable across Postgres/SQLite/Azure SQL, and easy to reason about in a review;
   the base-queryset pattern makes "forgetting" it the hard path. In production I'd
   *add* DB-level RLS (Azure SQL security policies keyed on a session tenant id) as
   a belt-and-suspenders layer, not a replacement.

3. **Property-grained real-time groups vs. a single per-org channel.**
   *Chose:* one WebSocket group per property; clients join only entitled groups.
   *Gave up:* a bit more group bookkeeping per connection. *Why:* an org-level
   channel would deliver *every* property's events to *every* org user and then
   rely on client-side filtering — which leaks other-property activity to non-admin
   users. Per-property groups make non-leakage a property of the transport itself.
