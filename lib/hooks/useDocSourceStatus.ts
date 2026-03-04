import { useState, useEffect, useCallback, useRef } from "react";
import { DocSourceStatus } from "@/lib/db/docSource";

type StatusData = {
  status: DocSourceStatus | null;
  statusMessage: string | null;
  documentCount: number | null;
  chunkCount: number | null;
};

type UseDocSourceStatusResult = StatusData & {
  isLoading: boolean;
  error: Error | null;
  startPolling: () => void;
};

const TERMINAL = new Set<DocSourceStatus>(["ready", "error"]);
const FALLBACK_POLL_MS = 4000;

export function useDocSourceStatus(
  docSourceId: string,
): UseDocSourceStatusResult {
  const [data, setData] = useState<StatusData>({
    status: null,
    statusMessage: null,
    documentCount: null,
    chunkCount: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Refs so we can clean up without stale closures
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const applyUpdate = useCallback((result: StatusData) => {
    if (!mountedRef.current) return;
    setData(result);
    setIsLoading(false);
    setError(null);
  }, []);

  // ── Polling fallback (used when SSE/Redis unavailable) ──────────────────
  const startFallbackPolling = useCallback(() => {
    if (pollRef.current) return; // already polling

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/doc-source/${docSourceId}?t=${Date.now()}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Poll failed");
        const result: StatusData = await res.json();
        applyUpdate(result);

        if (result.status && TERMINAL.has(result.status)) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error("Unknown error"));
          setIsLoading(false);
        }
      }
    };

    poll(); // immediate first call
    pollRef.current = setInterval(poll, FALLBACK_POLL_MS);
  }, [docSourceId, applyUpdate]);

  // ── SSE connection ───────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (!mountedRef.current) return;
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    // Check if SSE is supported and Redis is configured (REDIS_HOST present)
    if (typeof EventSource === "undefined") {
      startFallbackPolling();
      return;
    }

    const es = new EventSource(`/api/doc-source/${docSourceId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const payload: StatusData = JSON.parse(e.data);
        applyUpdate(payload);

        if (payload.status && TERMINAL.has(payload.status as DocSourceStatus)) {
          es.close();
          esRef.current = null;
        }
      } catch {
        // malformed event — ignore
      }
    };

    es.onerror = () => {
      // SSE failed (Redis unavailable or network error) — fall back to polling
      es.close();
      esRef.current = null;
      startFallbackPolling();
    };
  }, [docSourceId, applyUpdate, startFallbackPolling]);

  // ── Public: startPolling (called by re-index button for optimistic update) ─
  const startPolling = useCallback(() => {
    // Reset to loading state, then reconnect SSE (which sends DB snapshot first)
    setData((prev) => ({
      ...prev,
      status: "pending",
      statusMessage: "Starting retry...",
    }));
    setIsLoading(true);

    // Stop any existing connections
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    // Small delay to let backend update DB before we reconnect
    setTimeout(connectSSE, 1000);
  }, [connectSSE]);

  // ── Mount / unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    connectSSE();

    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [connectSSE]);

  return {
    ...data,
    isLoading,
    error,
    startPolling,
  };
}
