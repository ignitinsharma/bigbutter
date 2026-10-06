// useStats: navbar totals + filter-chip counts, independent of the batch being viewed.
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import type { NoteStats } from "../../../lib/types";
import type { HttpError } from "../helpers";

// Used by: useNotesPage. authFail turns a 401 into a /login bounce.
export function useStats(authFail: (e: HttpError) => boolean) {
  const [stats, setStats] = useState<NoteStats>({ total: 0, counts: {}, connections: 0 });

  // Refresh after any mutation.
  const loadStats = () => api("/notes/stats").then(
    (r: NoteStats) => {
      if (r && typeof r.total === "number") setStats({ total: r.total, counts: r.counts || {}, connections: r.connections || 0, buckets: r.buckets || {}, bucket_names: r.bucket_names || [] });
    },
    (e: HttpError) => { authFail(e); },
  );
  useEffect(() => { loadStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A just-saved note counts at once, before the stats refetch lands.
  const countNew = (type: string) =>
    setStats(st => ({ ...st, total: st.total + 1, counts: { ...st.counts, [type]: (st.counts[type] || 0) + 1 } }));

  return { stats, loadStats, countNew };
}
