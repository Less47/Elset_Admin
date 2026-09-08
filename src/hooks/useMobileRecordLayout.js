import { useMediaQuery } from "@/hooks/useMediaQuery";

const mobileRecordLayoutQuery = "(max-width: 47.999rem)";

export function useMobileRecordLayout() {
  return useMediaQuery(mobileRecordLayoutQuery);
}
