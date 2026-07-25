# Senior Engineer Take-Home — Multi-Tenant CapEx Budget & Approval Platform

> **In plain terms:** build an app where many separate companies share one system but must
> **never** see each other's data, users submit spending requests that need **sign-off from
> a chain of managers**, and bosses get a fast **analytics dashboard** of planned-vs-actual
> spending. The "CapEx / budget" framing is just a backdrop — **this is fundamentally a
> multi-tenant access-control + analytics-at-scale problem.** No finance background needed —
> read the primer below.
>
> *(CapEx = "Capital Expenditure" = spending on big physical things like a new roof or
> HVAC system. You don't need to know more than that.)*

**Track:** Full-Stack Platform Challenge
**Level:** Senior (5+ years)
**Time box:** **6 hours, hard limit.** See *How to spend the 6 hours* below.

---

## Read this first — how we grade

This is a **platform** challenge, not a feature checklist. We are evaluating whether you can
make **end-to-end architectural decisions** — authorization, data aggregation, caching,
real-time, and product tradeoffs — and stitch a backend and frontend into a coherent whole.
The hard parts here are **multi-tenant authorization (row-level security)**, **analytics
that don't recompute from scratch on every request**, and **keeping a dashboard correct and
fast under concurrent activity**. Anyone can build CRUD; we want to see you choose *where*
the complexity should live.

Your submission has two parts and **both are graded**:

- **Part A — Working vertical slice.** A runnable full-stack app (Django + DRF backend,
  React + TS frontend, Redis, a worker) that demonstrates the hard mechanisms end to end on
  seeded data — not every feature, but the *load-bearing* ones done correctly.
- **Part B — Design document (`DESIGN.md`).** How the platform scales and stays correct at
  the stated volume, with explicit tradeoffs. Weighted as heavily as the code.

A smaller slice where **authz, caching, and aggregation are correct**, plus a sharp design
doc, **beats** a broad app that leaks data across tenants or recomputes analytics on every
page load. **Tell us what you deferred and why.**

---

## Domain primer (no finance background needed)

You do **not** need to know accounting. Map every term to something you already understand:

- **CapEx (Capital Expenditure) project** — a request to spend money on a big asset (e.g.
  "$120k to replace the roof on Building 3"). For you it's just a record with a title, a
  budgeted amount, an actual cost, a category, and a status. Treat "CapEx project" as "a
  spending request."
- **Organization (tenant)** — a separate customer company using the app. **Multi-tenant**
  means many organizations share one deployment but each must be completely walled off from
  the others' data. This isolation is the hardest, most important requirement.
- **Property** — a sub-unit within an organization (e.g. a specific hotel/building). Projects
  belong to a property. Users are granted access to *specific* properties.
- **Budget / actuals / variance** — plain arithmetic:
  - **Budget** = the amount planned/allocated.
  - **Actuals** = the amount actually spent.
  - **Variance** = the difference (actuals − budget), usually shown as a % — i.e. "how far
    over or under plan are we." These are the numbers the dashboard shows.
- **Fiscal period** — the financial year/quarter a budget applies to (e.g. "FY2025"). Just a
  grouping label.
- **Approval workflow (multi-level)** — a request must be approved by several people **in
  order** before it's final (e.g. submitted → manager approves → finance approves →
  approved). Your backend enforces the rules: you can't skip a level, can't approve out of
  turn, and two people can't corrupt it by acting at once. It's a **state machine**.
- **Roles** — who can do/see what: an **org_admin** sees their whole company; a
  **property_manager / approver / viewer** sees only the specific properties they're assigned
  to. (See the role table below.)
- **Row-level security (RLS)** — the engineering requirement that the *server* (not just the
  UI) guarantees a user can only ever read/write rows they're entitled to — even if they
  guess an ID or hit the API directly. This is the crux of the assignment.

**The engineering problem, stripped of finance:** a multi-tenant app where (1) access control
must be enforced centrally and be airtight (no company ever sees another's rows, no user sees
properties they weren't granted — even via direct API calls), (2) an analytics dashboard must
stay fast over millions of rows without recomputing everything on each request, and (3)
status changes propagate live to the right users only. That's it.

---

## The scenario

Blue Ocean builds capital-expenditure and approval platforms for large property portfolios
(this mirrors a real engagement). Properties submit capital projects; budgets are allocated
per property; projects move through a **multi-level approval workflow**; and leadership
watches an **analytics dashboard** of budget-vs-actuals, variance, and approval throughput.

> You are building the core of this platform: a **multi-tenant** API where users only ever
> see data for properties they're entitled to (enforced server-side — **row-level
> security**), a **background aggregation** pipeline that feeds a **cached analytics
> dashboard**, **real-time** updates when approvals change, and a React dashboard that
> consumes it.

### Domain model (minimum)

- **Organizations** (tenants) → **Properties** → **CapEx Projects**.
- **Users** with **roles**: `org_admin`, `property_manager`, `approver`, `viewer`. A user is
  scoped to one or more properties (except `org_admin`, scoped to the whole org).
- **Projects** have a budget, a category, a status, and a cost (actuals). They move through
  **approval levels** (e.g. submitted → manager → finance → approved/rejected).
- **Budgets** allocated per property per fiscal period.

### Scale & behavior assumptions (these are the point)

- **500+ organizations**, each with **dozens of properties**; **~5 million projects** total
  historically, growing steadily. A single org dashboard aggregates over **tens of
  thousands** of its own projects.
- The analytics dashboard (budget vs actuals, variance %, approval cycle time, spend by
  category, pending-approval backlog) is hit frequently and must load **fast** — it cannot
  run heavy `GROUP BY`s over millions of rows on every request.
- **Authorization is the hard requirement**: a `property_manager` for Property A must be
  **unable** to read or mutate Property B's data through *any* endpoint — list, detail,
  analytics, export, or by guessing IDs. This must be enforced centrally, not per-view.
- Approval actions by one user must reflect on others' dashboards **in near-real-time**.
- Writes are concurrent: two approvers may act on the same project at once.

---

## Required stack (Blue Ocean's stack)

- **Backend:** Python 3.11+, **Django + Django REST Framework** (Django Ninja acceptable).
- **Redis required** — used meaningfully for caching aggregates and/or as the worker
  broker / Channels layer.
- **Background worker required:** `django-q2` / Celery / RQ (we use django-q2 + Celery).
- **Real-time:** Django Channels (WebSocket) preferred; SSE or short-poll is acceptable **if
  you justify it** in `DESIGN.md`.
- **Database:** Postgres preferred (SQLite acceptable for the slice; discuss the production
  DB — we run Azure SQL — in `DESIGN.md`).
- **Frontend:** **React 18 + TypeScript + Redux Toolkit + MUI**, charts via Recharts/Chart.js.
- **Auth:** JWT (DRF SimpleJWT) or session — your choice, defended. (We use JWT + Azure AD
  SSO in production; you do **not** need to integrate SSO — stub it and discuss.)
- **Containerized:** `docker compose up` brings up API + worker + Redis + DB + frontend (or
  documented equivalent).

---

## What we provide (`harness/`)

- **`seed.py`** — a Django-agnostic seeding script + spec that generates a realistic
  multi-tenant dataset (organizations, properties, users with roles, budgets, and a large
  volume of projects with statuses/costs) deterministically from a seed. Use it to populate
  your DB so your authz and aggregation are tested against real fan-out (one org with tens of
  thousands of projects, multiple tenants whose data must never mix).
- **`README.md`** — the data shape, the role/entitlement matrix, and suggested fiscal periods.

You implement the models/migrations; the seeder shows the exact shape to target (and can be
adapted to your ORM).

---

## Part A — Working vertical slice (build the load-bearing path end to end)

You do **not** need every feature. You **do** need these mechanisms working correctly,
end-to-end, on seeded multi-tenant data:

1. **Authentication + multi-tenant authorization with row-level security.**
   - Login issuing a token; role + property entitlements encoded server-side.
   - **Central RLS enforcement** — a queryset/permission layer (middleware, manager, or
     DRF permission + base queryset) so **every** read/write is automatically scoped to the
     caller's entitled properties. Demonstrate that Property A's manager gets `403`/`404`
     (your choice, defended) on Property B's project **by ID**, on list, and on analytics.
   - Show it with a test: cross-tenant access is denied at the data layer, not just hidden
     in the UI.

2. **CapEx project + approval workflow.**
   - CRUD for projects within the caller's scope.
   - A multi-level approval action (submit → approve/reject at a level) with **server-side
     state-machine** validation (can't skip levels, can't approve your own past the allowed
     level, concurrent-action safety). One real workflow path is enough.

3. **Background aggregation feeding a cached analytics endpoint.**
   - A **worker job** that computes per-org/per-property aggregates (budget vs actuals,
     variance %, spend by category, pending-approval count, avg approval cycle time) and
     stores them so the dashboard endpoint is **fast** (precomputed table and/or Redis
     cache) rather than scanning millions of rows per request.
   - A defensible **invalidation/refresh** strategy (on write? on schedule? incremental?).
     Stale-but-fast vs fresh-but-slow is a core tradeoff — make a choice and defend it.

4. **Analytics dashboard endpoint(s)** that serve the precomputed aggregates, scoped by RLS
   (an org_admin sees the org; a property_manager sees only their properties).

5. **Real-time approval updates.** When an approval changes, connected dashboards update in
   near-real-time (Channels/WebSocket preferred). Scope the broadcast to the right tenant —
   don't leak another org's events.

6. **React dashboard (frontend).** A real dashboard consuming the analytics endpoint: KPI
   cards + at least two charts (e.g. budget-vs-actuals by category, approval backlog/cycle
   time), a project list scoped to the user, and an approval action that updates
   **optimistically** and reflects the real-time event. Auth-gated; role-aware UI.

7. **Tests** for the things that must be correct: **cross-tenant denial**, the approval
   state-machine rules, and the aggregation correctness (precomputed == ground truth).

**You do not need to:** integrate real SSO, build every role's full UI, handle file uploads,
or implement export (note it in `DESIGN.md`). Depth on authz + aggregation + real-time beats
breadth.

---

## Part B — Design document (`DESIGN.md`)

Graded as heavily as the code. Be concrete. Address:

1. **Architecture + the path of a request** (auth → RLS → data → cache), with a diagram.

2. **Authorization model & enforcement.** How RLS is enforced centrally so no endpoint can
   forget it. The threat model: how does Property B's data stay invisible across list,
   detail, analytics, export, and ID-guessing? `403` vs `404` and why. How roles compose.

3. **Analytics at scale.** How the dashboard stays fast over **5M+ projects / tens of
   thousands per org**: precompute vs on-demand, where aggregates live, incremental vs full
   recompute, and your **cache invalidation** strategy and its staleness window. What the
   first-load and steady-state latencies are and why.

4. **Real-time delivery at scale.** How approval events reach the right dashboards without
   cross-tenant leakage, fan-out cost, and what happens at 10k concurrent dashboard sockets.

5. **Concurrency & correctness.** Two approvers act at once; an aggregation job runs while
   writes land. How do you avoid lost updates / wrong aggregates?

6. **Production DB & deployment.** You used Postgres/SQLite; we run **Azure SQL** + AKS.
   What changes? Migrations, connection pooling, read replicas, indexing for the aggregates.

7. **Tradeoffs.** The three biggest decisions, what you chose, what you gave up.

---

## Deliverables

```
your-submission/
├── README.md          # setup/run (docker compose up), built vs deferred, time per area
├── DESIGN.md          # Part B — architecture, authz, analytics, real-time, tradeoffs
├── docker-compose.yml # API + worker + Redis + DB + frontend (or documented equivalent)
├── backend/ ...       # Django + DRF + worker
├── frontend/ ...      # React + TS + RTK + MUI
└── tests/ ...         # cross-tenant denial, state machine, aggregation correctness
```

## Submission

- A **Git repo** (preferred) or zip without `node_modules` / `.venv` / build artifacts.
- Runnable with the documented command in **under 10 minutes**, seeded with multi-tenant data.
- You will **walk us through the architecture and defend the authz + caching design** in a
  30-minute call. Build only what you can explain.

---

## How to spend the 6 hours (suggested)

| Time | Focus |
|------|-------|
| 0:00–0:45 | Models + seed + decide RLS enforcement point and cache/aggregation strategy. |
| 0:45–2:30 | Auth + **central RLS** + project CRUD + approval state machine (backend). |
| 2:30–3:30 | Worker aggregation job + cached analytics endpoint + invalidation. |
| 3:30–4:15 | Real-time approval broadcast (tenant-scoped). |
| 4:15–5:15 | React dashboard: KPIs + 2 charts + optimistic approval + real-time. |
| 5:15–6:00 | Tests (cross-tenant denial, state machine, aggregation) + `DESIGN.md`. |

If you run low, **make authz airtight and write the design** — a platform that leaks tenant
data is an automatic fail no matter how nice the dashboard looks.

---

## Evaluation (what we weight)

| Area | Weight | What we look for |
|------|--------|------------------|
| **Architecture & design thinking** (incl. `DESIGN.md`) | 25% | Coherent end-to-end design; clear decisions; scaling reasoning; tradeoffs |
| **Authorization & multi-tenant correctness** | 25% | Central RLS; no cross-tenant leak on any path; tested; sound `403`/`404` reasoning |
| **Data aggregation & caching** | 20% | Precompute/cache that stays fast at scale; defensible invalidation; correct aggregates |
| **Real-time & concurrency** | 10% | Tenant-scoped real-time; safe concurrent approvals |
| **Frontend** | 10% | Role-aware dashboard, optimistic approval, real-time reflected, sound TS |
| **Code quality & tests** | 10% | Layered, readable; the right tests for authz/state/aggregation |

**Bar:** A senior offer requires strong marks in *both* Authorization and Aggregation/
Caching. **Any cross-tenant data leak is an automatic fail**, regardless of the rest.

### Bonus (only after the core is solid)
- Incremental aggregation (update rollups on write rather than full recompute).
- Optimistic concurrency control (version/ETag) on approvals with conflict handling.
- A meaningful index/query plan note for the aggregate queries on the production DB.
- Audit log of approval actions.

---

## Ground rules

- Use any libraries/AI assistants you like — **you must defend every decision live**.
  Unexplained code counts against you.
- **Authorization is enforced server-side, centrally.** Hiding data only in the React UI is
  a fail — we will hit the API directly with the wrong user's token.
- State your assumptions in writing. Senior engineers make assumptions explicit.
