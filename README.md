# job-lease

Lease a background job on one plane, and accept the result only from that plane and that worker.

A queue that stores "queued" in one place and "done" in another will wait forever: the waiter is looking at an id that the worker never wrote. A worker that posts the result to a different plane creates the same stall. This queue refuses both.

```js
import { createQueue } from "./src/index.js";

const queue = createQueue();
queue.enqueue("job-1", "mesh", Date.now());
queue.lease("job-1", "worker-a", "mesh", Date.now());
queue.complete("job-1", "worker-a", "mesh", { text: "done" }, Date.now());
```

A second worker cannot complete the lease. A result on plane `edge` is rejected while the job remains leased on `mesh`. A second enqueue of a live id returns `exists` instead of creating a twin. `expire` turns a lease that outlives its window into `lease_timeout`.

The plane name is an opaque string. Use it for any split between an intake service and a worker service.

```
node --test
```

MIT. Vadim Gubin.
