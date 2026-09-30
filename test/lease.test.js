import assert from "node:assert/strict";
import test from "node:test";
import { createQueue } from "../src/index.js";

test("the worker that leased the job is the only one that can finish it", () => {
  const queue = createQueue();
  assert.equal(queue.enqueue("job-1", "mesh", 1000).ok, true);
  assert.equal(queue.lease("job-1", "worker-a", "mesh", 1100).ok, true);
  assert.equal(queue.complete("job-1", "worker-b", "mesh", { text: "other" }, 1200).reason, "not_owner");
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
