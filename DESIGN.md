## 1. Architecture & request path

```
   Browser (React SPA)                Daphne (ASGI)
   ┌───────────────┐   HTTP  ┌────────────────────────────┐
   │ RTK Query     │────────▶│  DRF views  ·  Channels     │
   │ MUI dashboard │   WS    │                             │
   └───────────────┘◀───────┤                             │
                            └──────┬───────────────┬───────┘
                                   │               │
                            Postgres              Redis
                     (rows + PropertyAggregate    (cache · channel
                      cells)                       layer · broker)
                                   ▲                    ▲
                                   └── Celery worker ───┘
                                    (refresh cell on write)
```

Path of request: authenticate JWT → scope the queryset to the caller via manager →
  serve the precomputed aggregate from Redis or aggregate on the fly if cache miss.

---

## 2. Authorization (row-level security)

Two-level tenancy from the harness contract:

| role | scope |
|------|-------|
| `org_admin` | the whole org, never another org |
| `property_manager` | only their `property_ids`; full CRUD there |
| `approver` | only their `property_ids`; may act on approvals |
| `viewer` | only their `property_ids`; read-only |


RLS is enforced via Django managers using `core/rls.py::scope_to_user` function
that filters queryset based on user role and organization.

HTTP code 404 was chosen because a user should not know about the existence
of a resource if it doesn't own it, this better isolate each tenant.

---

## 3. Analytics at scale

Analytics are precomputed on every write using Django signals and Celery for background work.
We aggregate all relevant data using PropertiesAggregate model, when a user request analytics we look
for values in cache first, if it miss a analytics are created from precomputed values and
added to the Redis cache.

Latency is 17ms for a cache hit and 23ms for a cache miss given that results were pre aggregated before
cache recalculation.


---

## 4. Real-time delivery

Approvel events are sent to the dashboard using Django Channels via WebSocket.
On connect the client subscribe to events from its entitled properties, this avoids
listening to other propeties events.

---

## 5. Concurrency & correctness

Concurrent approvals are serialized using `select_for_update`, only the first approve
will be accepted, the second one will be rejected by the state machine because of the new
updated stated. Aggregation jobs are not affected because they are always derived after the
write is accepted.

---

## 6. Production DB & deployment (Azure SQL + AKS)

This project runs on Postgres, moving to Azure SQL should change only small details like
database driver, not meaningful parts of the code.


---

## 7. Biggest tradeoffs

Enforcing RLS via ORM instead of using database policies. Our solution allow someone to bypass
tenant isolation by writing raw sql, but the choice to enforce RLS on ORM layer gives us
a centralized and portable solution.

