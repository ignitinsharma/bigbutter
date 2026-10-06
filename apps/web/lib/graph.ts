// graph: client-side mirror of GET /map (shared tag/person/category = edge).
import type { Note } from "./types";

const lc = (s: string) => String(s).toLowerCase().trim();

export type GraphNode = { id: string; note: Note; deg: number; r: number };
export type GraphLink = { source: string; target: string; shared: string[]; weight: number };
export type Graph = { nodes: GraphNode[]; links: GraphLink[] };

// Build nodes + edges: one node per note, edge iff shared tag/person/category.
export function buildGraph(notes: Note[]): Graph {
  const links: GraphLink[] = [];
  for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
    const a = notes[i], b = notes[j];
    const at = new Set((a.tags || []).map(lc)), ap = new Set((a.people || []).map(lc));
    const cat = a.category && b.category && lc(a.category) === lc(b.category) ? [lc(a.category)] : [];
    const shared = Array.from(new Set([
      ...cat,
      ...(b.tags || []).filter(t => at.has(lc(t))),
      ...(b.people || []).filter(p => ap.has(lc(p))),
    ]));
    if (shared.length) links.push({ source: a.id, target: b.id, shared, weight: shared.length });
  }
  const deg: Record<string, number> = {};
  links.forEach(l => { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; });
  const nodes = notes.map(n => ({ id: n.id, note: n, deg: deg[n.id] || 0, r: 8 + Math.min(10, (deg[n.id] || 0) * 2) }));
  return { nodes, links };
}

// Search scope: only the hit nodes and the edges among them, degree recomputed inside.
export function subgraph<N extends { id: string; deg: number; r: number }>(
  g: { nodes: N[]; links: GraphLink[] }, ids: Iterable<string>,
): { nodes: N[]; links: GraphLink[] } {
  const keep = new Set(ids);
  const links = g.links.filter(l => keep.has(l.source) && keep.has(l.target));
  const deg: Record<string, number> = {};
  links.forEach(l => { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; });
  const nodes = g.nodes.filter(n => keep.has(n.id))
    .map(n => ({ ...n, deg: deg[n.id] || 0, r: 8 + Math.min(10, (deg[n.id] || 0) * 2) }));
  return { nodes, links };
}

