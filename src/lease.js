export function createQueue() {
  const jobs = new Map();

  function get(id) {
    return jobs.get(id) || null;
  }

  return {
    enqueue(id, plane, nowMs) {
      if (!id || !plane) return { ok: false, reason: "missing" };
      const existing = jobs.get(id);
      if (existing && existing.state !== "failed" && existing.state !== "done") {
        return { ok: false, reason: "exists", job: existing };
      }
      const job = { id, plane, state: "queued", leasedBy: null, result: null, at: nowMs };
      jobs.set(id, job);
      return { ok: true, job };
    },
    lease(id, worker, plane, nowMs) {
      const job = jobs.get(id);
      if (!job) return { ok: false, reason: "missing" };
      if (job.plane !== plane) return { ok: false, reason: "plane_mismatch", job };
      if (job.state === "done" || job.state === "failed")
        return { ok: false, reason: "closed", job };
      if (job.state === "leased" && job.leasedBy !== worker)
        return { ok: false, reason: "leased", job };
      job.state = "leased";
      job.leasedBy = worker;
      job.at = nowMs;
      return { ok: true, job };
    },
    complete(id, worker, plane, result, nowMs) {
      const job = jobs.get(id);
      if (!job) return { ok: false, reason: "missing" };
      if (job.plane !== plane) return { ok: false, reason: "plane_mismatch", job };
      if (job.state !== "leased" || job.leasedBy !== worker)
        return { ok: false, reason: "not_owner", job };
      job.state = "done";
      job.result = result;
      job.at = nowMs;
      return { ok: true, job };
    },
    fail(id, plane, reason, nowMs) {
      const job = jobs.get(id);
      if (!job) return { ok: false, reason: "missing" };
      if (job.plane !== plane) return { ok: false, reason: "plane_mismatch", job };
      if (job.state === "done") return { ok: false, reason: "closed", job };
      job.state = "failed";
      job.result = { reason };
      job.at = nowMs;
      return { ok: true, job };
    },
    expire(nowMs, leaseMs) {
      const expired = [];
      for (const job of jobs.values()) {
        if (job.state === "leased" && nowMs - job.at >= leaseMs) {
          job.state = "failed";
          job.result = { reason: "lease_timeout" };
          job.at = nowMs;
          expired.push(job.id);
        }
      }
      return expired;
    },
    get,
  };
}
