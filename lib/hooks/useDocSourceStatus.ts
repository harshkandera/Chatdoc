import { useState, useEffect, useCallback, useRef } from "react";
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

  const [shouldPoll, setShouldPoll] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Optimistic update to fix race condition
  const startPolling = useCallback(() => {
    setShouldPoll(true);
    setData((prev) => ({
      ...prev,
      isLoading: true,
      status: "pending", // Force status to pending so isTerminal doesn't kill it immediately
      statusMessage: "Starting retry...",
    }));
  }, []);

  useEffect(() => {
    let isMounted = true;

    const fetchStatus = async () => {
      try {
        const response = await fetch(
          `/api/doc-source/${docSourceId}?t=${Date.now()}`,
          {
            cache: "no-store",
            headers: {
              Pragma: "no-cache",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            },
          },
        );

        if (!response.ok) throw new Error("Failed to fetch status");

        const result = await response.json();

        if (isMounted) {
          setData((prev) => ({
            ...prev,
            status: result.status,
            statusMessage: result.statusMessage,
            documentCount: result.documentCount,
            chunkCount: result.chunkCount,
            isLoading: false,
            error: null,
          }));

          const isTerminal =
            result.status === "ready" || result.status === "error";

          // Only stop polling if the API actually confirms a terminal state
          // AND we are not in the middle of a forced retry (handled by the optimistic update above)
          if (isTerminal) {
            setShouldPoll(false);
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

    // Polling Logic
    if (shouldPoll) {
      // Delay first fetch by 1s to allow backend to update DB (fix race condition)
      const initialDelayId = setTimeout(() => {
        fetchStatus();
        // Set interval after first fetch
        pollIntervalRef.current = setInterval(fetchStatus, 3000);
      }, 1000);

      return () => {
        clearTimeout(initialDelayId);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    } else {
      // Stop polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    // Initial fetch if not polling but component mounted (to get initial state)
    // We only do this if we haven't fetched yet (status is null) AND not polling
    if (!shouldPoll && data.status === null) {
      fetchStatus();
    }

    return () => {
      isMounted = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [docSourceId, shouldPoll]); // data.status excluded to prevent loops

  return { ...data, startPolling };
}
