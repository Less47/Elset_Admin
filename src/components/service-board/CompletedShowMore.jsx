import { Button } from "@/components/ui/button";
import { COMPLETED_JOB_BATCH_SIZE } from "./useCompletedJobLimit";

export default function CompletedShowMore({ visibleLimit, totalCount, onShowMore }) {
  if (visibleLimit >= totalCount) return null;
  return <div className="flex justify-center pt-3">
    <Button type="button" variant="outline" size="sm" onClick={onShowMore}
      aria-label={`Show ${Math.min(COMPLETED_JOB_BATCH_SIZE, totalCount - visibleLimit)} more completed jobs`}>
      Show {Math.min(COMPLETED_JOB_BATCH_SIZE, totalCount - visibleLimit)} more
    </Button>
  </div>;
}
