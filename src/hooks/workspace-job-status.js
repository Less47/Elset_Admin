const statusFields = ["status", "updatedAt", "serviceBoardTomorrowDate", "serviceBoardTomorrowOrder"];
const pick = (job, keys = statusFields) => Object.fromEntries(keys.map((key) => [key, job[key]]));

// Merge only fields owned by this status operation, retaining unrelated concurrent edits.
export function mergeJobStatusFields(state, jobId, fields, expected) {
  let changed = false;
  const jobs = state.jobs.map((job) => {
    if (job.id !== jobId || (expected && job.status !== expected.status)) return job;
    const patch = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
      !Object.is(job[key], value) && (!expected || Object.is(job[key], expected[key]))));
    if (!Object.keys(patch).length) return job;
    changed = true;
    return { ...job, ...patch };
  });
  return changed ? { ...state, jobs } : state;
}

export async function requestJobStatusUpdate({ fetchWithAuth, jobId, status, expectedStatus }) {
  const response = await fetchWithAuth(`/api/jobs/${encodeURIComponent(jobId)}/status?response=delta`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, expectedStatus }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.result?.job?.id !== jobId || payload.result.job.status !== status) {
    const error = new Error(payload.error || "Unable to update the job status.");
    if (payload.currentJob?.id === jobId) error.currentJob = payload.currentJob;
    throw error;
  }
  return payload.result;
}

// One queue per job preserves rapid successive drops; unrelated jobs save independently.
export function createJobStatusQueue() {
  const pending = new Map();
  return ({ job, nextStatus, save, merge, onSaved, onError }) => {
    const previous = pending.get(job.id);
    const optimistic = { ...pick(job), status: nextStatus, updatedAt: new Date().toISOString(),
      ...(nextStatus === "Completed" ? { serviceBoardTomorrowDate: "", serviceBoardTomorrowOrder: null } : {}) };
    merge(optimistic);
    const operation = {};
    pending.set(job.id, operation);
    operation.promise = (async () => {
      let confirmed = previous ? (await previous.promise).confirmed : pick(job);
      try {
        const result = await save(nextStatus, confirmed.status);
        confirmed = pick(result.job);
        if (pending.get(job.id) === operation) merge(confirmed, optimistic);
        onSaved?.(result);
        return { ok: true, confirmed };
      } catch (error) {
        confirmed = error.currentJob ? pick(error.currentJob) : confirmed;
        if (pending.get(job.id) === operation) merge(confirmed, optimistic);
        onError(error);
        return { ok: false, confirmed };
      } finally {
        if (pending.get(job.id) === operation) pending.delete(job.id);
      }
    })();
    return operation.promise.then(({ ok }) => ok);
  };
}
