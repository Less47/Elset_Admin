import { useState } from "react";

export const COMPLETED_JOB_BATCH_SIZE = 25;

export function useCompletedJobLimit(search, highUrgencyOnly, sortMode) {
  const criteria = JSON.stringify([search, highUrgencyOnly, sortMode]);
  const [pagination, setPagination] = useState({ criteria, limit: COMPLETED_JOB_BATCH_SIZE });
  // Reset before rendering a different result set; activity updates do not reset it.
  if (pagination.criteria !== criteria) {
    setPagination({ criteria, limit: COMPLETED_JOB_BATCH_SIZE });
  }
  const visibleLimit = pagination.criteria === criteria ? pagination.limit : COMPLETED_JOB_BATCH_SIZE;
  const showMore = () => setPagination((current) => ({ criteria, limit: current.limit + COMPLETED_JOB_BATCH_SIZE }));
  return { visibleLimit, showMore };
}
