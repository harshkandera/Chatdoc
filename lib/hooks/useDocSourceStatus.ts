import { useState, useEffect, useCallback } from "react";
import { DocSourceStatus } from "@/lib/db/docSource";

type UseDocSourceStatusResult = {
  status: DocSourceStatus | null;
  statusMessage: string | null;
  documentCount: number | null;
  chunkCount: number | null;
  isLoading: boolean;
  error: Error | null;
  startPolling: () => void;
};

export function useDocSourceStatus(
  docSourceId: string,
): UseDocSourceStatusResult {
  const [data, setData] = useState<
    Omit<UseDocSourceStatusResult, "startPolling">
  >({
    status: null,
    statusMessage: null,
    documentCount: null,
    chunkCount: null,
    isLoading: true,
    error: null,
  });

  // Force polling state
  const [shouldPoll, setShouldPoll] = useState(false);

  const startPolling = useCallback(() => {
    setShouldPoll(true);
    setData((prev) => ({
      ...prev,
      isLoading: true,
      // Optional: optimistic update could be done here but let's stick to polling trigger
    }));
  }, []);

  useEffect(() => {
    let isMounted = true;
    let timeoutId: NodeJS.Timeout;

    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/doc-source/${docSourceId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch status");
        }

        const result = await response.json();
        const { status, statusMessage, documentCount, chunkCount } = result;

        if (isMounted) {
          setData({
            status,
            statusMessage,
            documentCount,
            chunkCount,
            isLoading: false,
            error: null,
          });

          // Check if terminal
          const isTerminal = status === "ready" || status === "error";

          if (isTerminal) {
            setShouldPoll(false);
          }

          // Continue polling if processing OR forced
          if (
            !isTerminal &&
            (status === "pending" ||
              status === "scraping" ||
              status === "chunking" ||
              status === "embedding" ||
              status === "storing" ||
              shouldPoll)
          ) {
            timeoutId = setTimeout(fetchStatus, 3000); // Poll every 3 seconds
          }
        }
      } catch (error) {
        if (isMounted) {
          setData((prev) => ({
            ...prev,
            isLoading: false,
            error: error instanceof Error ? error : new Error("Unknown error"),
          }));
        }
      }
    };

    fetchStatus();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [docSourceId, shouldPoll]);

  return { ...data, startPolling };
}
