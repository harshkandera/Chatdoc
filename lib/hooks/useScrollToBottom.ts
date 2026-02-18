import { useEffect, useRef, DependencyList } from "react";

export function useScrollToBottom<T extends HTMLElement>(
  deps: DependencyList = [],
) {
  const containerRef = useRef<T>(null);
  const endRef = useRef<T>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [containerRef, endRef] as const;
}
