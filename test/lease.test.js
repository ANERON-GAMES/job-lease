import assert from "node:assert/strict";
import test from "node:test";
import { createQueue } from "../src/index.js";

test("the worker that leased the job is the only one that can finish it", () => {
  const queue = createQueue();
  assert.equal(queue.enqueue("job-1", "mesh", 1000).ok, true);
  assert.equal(queue.lease("job-1", "worker-a", "mesh", 1100).ok, true);
  assert.equal(
    queue.complete("job-1", "worker-b", "mesh", { text: "other" }, 1200).reason,
    "not_owner",
  );
  assert.equal(queue.complete("job-1", "worker-a", "mesh", { text: "done" }, 1300).ok, true);
  assert.equal(queue.get("job-1").result.text, "done");
});

test("a result posted to a different plane is refused", () => {
  const queue = createQueue();
  queue.enqueue("job-2", "mesh", 1000);
  queue.lease("job-2", "worker-a", "mesh", 1100);
  const foreign = queue.complete("job-2", "worker-a", "edge", { text: "wrong plane" }, 1200);
  assert.equal(foreign.reason, "plane_mismatch");
  assert.equal(queue.get("job-2").state, "leased");
});

test("a second enqueue of a live job does not create a twin", () => {
  const queue = createQueue();
  queue.enqueue("job-3", "mesh", 1000);
  assert.equal(queue.enqueue("job-3", "mesh", 1100).reason, "exists");
});

test("an expired lease becomes a timeout, not a silent success", () => {
  const queue = createQueue();
  queue.enqueue("job-4", "mesh", 1000);
  queue.lease("job-4", "worker-a", "mesh", 1100);
  assert.deepEqual(queue.expire(1100 + 8000, 8000), ["job-4"]);
  assert.equal(queue.get("job-4").state, "failed");
  assert.equal(queue.get("job-4").result.reason, "lease_timeout");
});

test("fail marks the job failed on its plane and refuses a finished success", () => {
  const queue = createQueue();
  assert.equal(queue.fail("missing-job", "mesh", "worker_error", 900).reason, "missing");

  queue.enqueue("job-5", "mesh", 1000);
  const queued = queue.fail("job-5", "mesh", "dropped", 1050);
  assert.equal(queued.ok, true);
  assert.equal(queue.get("job-5").state, "failed");
  assert.equal(queue.get("job-5").result.reason, "dropped");

  queue.enqueue("job-6", "mesh", 1100);
  queue.lease("job-6", "worker-a", "mesh", 1200);
  const foreign = queue.fail("job-6", "edge", "worker_error", 1300);
  assert.equal(foreign.reason, "plane_mismatch");
  assert.equal(queue.get("job-6").state, "leased");

  const failed = queue.fail("job-6", "mesh", "worker_error", 1400);
  assert.equal(failed.ok, true);
  assert.equal(queue.get("job-6").state, "failed");
  assert.equal(queue.get("job-6").result.reason, "worker_error");
  assert.equal(queue.get("job-6").leasedBy, "worker-a");

  queue.enqueue("job-7", "mesh", 1500);
  queue.lease("job-7", "worker-a", "mesh", 1600);
  queue.complete("job-7", "worker-a", "mesh", { text: "done" }, 1700);
  assert.equal(queue.fail("job-7", "mesh", "too_late", 1800).reason, "closed");
  assert.equal(queue.get("job-7").state, "done");
  assert.equal(queue.get("job-7").result.text, "done");
});

test("a lease on the wrong plane is refused", () => {
  const queue = createQueue();
  queue.enqueue("job-8", "mesh", 1000);
  const foreign = queue.lease("job-8", "worker-a", "edge", 1100);
  assert.equal(foreign.reason, "plane_mismatch");
  assert.equal(foreign.job.state, "queued");
  assert.equal(queue.get("job-8").state, "queued");
  assert.equal(queue.get("job-8").leasedBy, null);
});

test("completing a job that is still queued is refused", () => {
  const queue = createQueue();
  queue.enqueue("job-9", "mesh", 1000);
  const early = queue.complete("job-9", "worker-a", "mesh", { text: "early" }, 1100);
  assert.equal(early.reason, "not_owner");
  assert.equal(early.job.state, "queued");
  assert.equal(queue.get("job-9").state, "queued");
  assert.equal(queue.get("job-9").result, null);
});

test("a finished id can be enqueued again", () => {
  const queue = createQueue();
  queue.enqueue("job-10", "mesh", 1000);
  queue.lease("job-10", "worker-a", "mesh", 1100);
  queue.complete("job-10", "worker-a", "mesh", { text: "done" }, 1200);
  const again = queue.enqueue("job-10", "edge", 1300);
  assert.equal(again.ok, true);
  assert.equal(again.job.state, "queued");
  assert.equal(again.job.plane, "edge");
  assert.equal(again.job.result, null);
  assert.equal(again.job.leasedBy, null);
  assert.equal(queue.get("job-10").at, 1300);
});
