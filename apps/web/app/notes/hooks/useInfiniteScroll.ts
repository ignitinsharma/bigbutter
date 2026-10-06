// useInfiniteScroll: calls onHit while the sentinel is within 800px of the viewport.
import { useEffect, useRef, type DependencyList } from "react";

// Re-created whenever deps change: observe() reports the current state at once,
// so a list shorter than the screen keeps filling it.
export function useInfiniteScroll(enabled: boolean, onHit: () => void, deps: DependencyList) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) onHit(); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return sentinel;
}
