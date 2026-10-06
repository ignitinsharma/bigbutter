// useRefreshing: ids of notes waiting on the AI step (cards show "Organizing…").
import { useState } from "react";

export function useRefreshing() {
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  // Always a new Set, so React sees the change.
  const startRefresh = (id: string) => setRefreshing(r => new Set(r).add(id));
  const endRefresh = (id: string) => setRefreshing(r => { const x = new Set(r); x.delete(id); return x; });
  return { refreshing, startRefresh, endRefresh };
}
