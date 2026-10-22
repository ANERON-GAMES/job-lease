# @aneron/job-lease

Lease a background job on one plane, and accept the result only from that plane and that worker.

## Purpose

A queue that stores "queued" in one place and "done" in another will wait forever: the waiter is looking at an id that the worker never wrote. A worker that posts the result to a different plane creates the same stall. This package is a single-process, in-memory queue that refuses both. It keeps one record per id and moves that record through `queued`, `leased`, `done`, and `failed`.

## Install

```bash
npm install github:ANERON-GAMES/job-lease
```

The package is ESM (`"type": "module"`). The entry point is `src/index.js`, which exports `createQueue`. Use Node 20 or newer.

```js
import { createQueue } from "@aneron/job-lease";
```

## Usage

```js
import { createQueue } from "@aneron/job-lease";

const queue = createQueue();
const now = Date.now();

queue.enqueue("job-1", "mesh", now);
queue.lease("job-1", "worker-a", "mesh", now);
queue.complete("job-1", "worker-a", "mesh", { text: "done" }, now);
```

A second worker cannot complete the lease. A result on plane `edge` is rejected while the job remains leased on `mesh`. A second enqueue of a live id returns `exists` instead of creating a twin. `expire` turns a lease that outlives the caller-supplied window into `failed` with reason `lease_timeout`.

`mesh` and `edge` are example plane names. A plane is an opaque string. Use it for any split between the side that enqueues the job and the side that runs it.

## API

### `createQueue()`

Returns a new queue. Jobs live in a `Map` inside that queue. Two queues do not share records.

`enqueue`, `lease`, `complete`, and `fail` return either `{ ok: true, job }` or `{ ok: false, reason }` with an optional `job`. `expire` returns an array of ids. `get` returns the stored job or `null`.

The `job` on a return value is the stored object, not a copy. Later calls mutate that same object. `enqueue` of a finished id stores a new object and leaves any previously returned object detached from the queue.

### Job fields

| Field      | Description                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | Value passed to `enqueue`. It is the `Map` key.                                                                                                 |
| `plane`    | Value passed to `enqueue`. Later calls compare it with `!==`.                                                                                   |
| `state`    | `queued`, `leased`, `done`, or `failed`.                                                                                                        |
| `leasedBy` | `null` until a lease succeeds, then the `worker` from that lease. `complete`, `fail`, and `expire` do not clear it.                             |
| `result`   | `null` until `complete`, `fail`, or `expire` sets it. `complete` stores its `result` argument as given. `fail` and `expire` store `{ reason }`. |
| `at`       | The `nowMs` from the call that last wrote the record.                                                                                           |

### `enqueue(id, plane, nowMs)`

Stores a queued job, or replaces a finished one.

1. If `id` or `plane` is falsy (`""`, `null`, `undefined`, `0`, or `false`), returns `{ ok: false, reason: "missing" }`. Nothing is stored. `nowMs` is not validated.
2. If a record with this `id` exists and its state is not `done` and not `failed`, returns `{ ok: false, reason: "exists", job }`. The stored job is unchanged. The `plane` on this call is not compared, so a second enqueue of a live id is refused on every plane.
3. Otherwise stores `{ id, plane, state: "queued", leasedBy: null, result: null, at: nowMs }` and returns `{ ok: true, job }`. A previous `done` or `failed` record with the same id is replaced.

### `lease(id, worker, plane, nowMs)`

Leases a queued job, or refreshes the timestamp when the same worker already holds it.

1. If no record is stored for `id`, returns `{ ok: false, reason: "missing" }`.
2. If `job.plane !== plane`, returns `{ ok: false, reason: "plane_mismatch", job }`. State does not change.
3. If `state` is `done` or `failed`, returns `{ ok: false, reason: "closed", job }`.
4. If `state` is `leased` and `job.leasedBy !== worker`, returns `{ ok: false, reason: "leased", job }`.
5. Otherwise sets `state` to `leased`, `leasedBy` to `worker`, and `at` to `nowMs`. `result` is left unchanged. Returns `{ ok: true, job }`.

`worker` is not checked for truthiness. The same worker may lease an id it already holds. That call succeeds and replaces `at`. A different worker cannot take the lease while it is held.

### `complete(id, worker, plane, result, nowMs)`

Accepts a result only from the worker that currently holds the lease, and only on the job's plane.

1. If no record is stored for `id`, returns `{ ok: false, reason: "missing" }`.
2. If `job.plane !== plane`, returns `{ ok: false, reason: "plane_mismatch", job }`. The plane is checked before ownership, so a queued, done, or failed job addressed on the wrong plane still returns `plane_mismatch`. State does not change.
3. If `state` is not `leased`, or `leasedBy !== worker`, returns `{ ok: false, reason: "not_owner", job }`. A job that is still `queued` takes this path. So does a `done` or `failed` job when the plane matches. The record does not change.
4. Otherwise sets `state` to `done`, `result` to the `result` argument, and `at` to `nowMs`. `leasedBy` stays as it was. Returns `{ ok: true, job }`.

### `fail(id, plane, reason, nowMs)`

Marks a job failed from its own plane. There is no `worker` argument and no `leasedBy` check. Any caller that passes the job's plane can fail it.

1. If no record is stored for `id`, returns `{ ok: false, reason: "missing" }`.
2. If `job.plane !== plane`, returns `{ ok: false, reason: "plane_mismatch", job }`.
3. If `state` is `done`, returns `{ ok: false, reason: "closed", job }`.
4. Otherwise sets `state` to `failed`, `result` to `{ reason }`, and `at` to `nowMs`. `leasedBy` stays as it was. Returns `{ ok: true, job }`.

`queued`, `leased`, and already `failed` jobs all take the success path. A second `fail` overwrites `result.reason` and `at`. `reason` is stored as given, including `undefined` when the argument is omitted.

### `expire(nowMs, leaseMs)`

Fails each `leased` job whose age has reached `leaseMs`. Returns the expired ids in insertion order. The array is empty when nothing expires.

A job is selected when `job.state === "leased"` and `nowMs - job.at >= leaseMs`. The queue then sets `state` to `failed`, `result` to `{ reason: "lease_timeout" }`, and `at` to `nowMs`. `leasedBy` stays as it was.

`queued`, `done`, and `failed` jobs are skipped. A queued job does not expire, however old `at` is. Calling `expire` again does not list a job that is already `failed`.

There is no default lease duration and no constant inside the package. Every call uses the `leaseMs` argument from that call. The queue never reads a clock. The caller supplies both `nowMs` and `leaseMs`, and the caller decides when to invoke `expire`.

An exact age of `leaseMs` expires, because the comparison is `>=`. A later `lease` by the same worker replaces `at`, so the next `expire` measures age from that later timestamp.

### `get(id)`

Returns the stored job object, or `null` when the id is absent.

### Reason strings

| Reason           | Where it appears                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing`        | Return `reason` from `enqueue` when `id` or `plane` is falsy. Return `reason` from `lease`, `complete`, or `fail` when the id is not stored.                                                                   |
| `exists`         | Return `reason` from `enqueue` when the stored job is still `queued` or `leased`. The return value includes `job`.                                                                                             |
| `plane_mismatch` | Return `reason` from `lease`, `complete`, or `fail` when the passed plane is not `job.plane`. The return value includes `job`.                                                                                 |
| `leased`         | Return `reason` from `lease` when a different worker already holds the lease. The return value includes `job`.                                                                                                 |
| `not_owner`      | Return `reason` from `complete` when this worker does not hold a current lease. That includes a job that is still `queued`, and a `done` or `failed` job whose plane matches. The return value includes `job`. |
| `closed`         | Return `reason` from `lease` when the job is `done` or `failed`. Return `reason` from `fail` when the job is `done`. The return value includes `job`.                                                          |
| `lease_timeout`  | Not a method return `reason`. `expire` writes it to `result.reason` as `{ reason: "lease_timeout" }` when a lease times out.                                                                                   |

`enqueue` does not return `plane_mismatch`, `leased`, `not_owner`, `closed`, or `lease_timeout`. `complete` does not return `closed` or `leased`. `fail` does not return `not_owner` or `leased`.

### States

| State    | Set by                                             |
| -------- | -------------------------------------------------- |
| `queued` | Successful `enqueue`.                              |
| `leased` | Successful `lease`.                                |
| `done`   | Successful `complete`.                             |
| `failed` | Successful `fail`, or `expire` timing out a lease. |

## Behavior and limits

- The queue is in memory. A process restart drops every job. The package does not write jobs to disk or send them anywhere.
- One id maps to one stored record. A second enqueue is refused only while that record is not `done` and not `failed`. A finished id can be enqueued again, and the new record replaces the stored one.
- The same worker may lease an id it already holds. A different worker may not, until the job is no longer `leased`.
- There is no renew method and no heartbeat. The only way to move `at` on a live lease is for the current worker to call `lease` again.
- `expire` flips `leased` jobs to `failed` with `result.reason` set to `lease_timeout`. It does not expire `queued` jobs.
- `leaseMs` always comes from the caller. The package does not choose a duration.
- `fail` does not require ownership. `complete` does. Completing a job that is still `queued` returns `not_owner` and leaves the job queued, with `result` still `null`.
- Leasing on a different plane returns `plane_mismatch` and leaves the job `queued` when it was queued.
- Ids, planes, and workers are compared as ordinary JavaScript values. The package does not interpret them.

## Design notes

Time is an argument so a test and a running process share the same rules. `expire` is a comparison of `nowMs - job.at` against the `leaseMs` passed into that call. Nothing in the queue schedules a timer.

The plane is the boundary between the side that created the job and the side that runs it. `lease`, `complete`, and `fail` all reject a different plane before they change state. That keeps a result from being stored on an id the other side is not reading.

`complete` is owner-checked because a result has to come from the worker that holds the lease. `fail` is only plane-checked so the plane that owns the job can abandon a lease without knowing `leasedBy`. `lease` reports `closed` once the job has left the active states. `complete` reports `not_owner` for those same finished states when the plane matches, because a finished job has no current lease holder. `fail` reports `closed` only for `done`, and a later `fail` may replace an existing failure reason.

Holding the returned `job` means holding the live record. Read `state` from it after later calls if you keep the reference. After `enqueue` replaces a finished id, call `get` for the new record.

## License

MIT. Copyright (c) 2026 Vadim Gubin. See [LICENSE](LICENSE).
