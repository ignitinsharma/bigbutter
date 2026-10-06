// useMapView: the map — /map graph (or a local one offline), search scoping, hover card + selected panel data.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
import type { Note, NoteType } from "../../../lib/types";
import { buildGraph, subgraph, type Graph } from "../../../lib/graph";
import { nodeColor } from "../../../lib/colors";
import type { View } from "./useViewControls";

// The map follows the stream's notes offline and the search hits while searching.
type MapOpts = { view: View; scoped: boolean; items: Note[]; searchRows: Note[]; sel: string | null };
// Hovered node + cursor position inside the map box.
type Hover = { id: string; x: number; y: number };
// One node as GET /map returns it.
type ApiNode = { id: string; title: string; type: NoteType; summary: string; color?: string; deg: number; r: number };

const CARD_W = 248; // hover card width (px)

// Hover card: the note, its most shared link terms ("Linked via"), and a spot beside the
// cursor that flips left/below near the edges so it never covers the node.
function hoverCardOf(hover: Hover | null, gmap: Graph, mapGraph: Graph, boxWidth: number) {
  const note = hover && gmap.nodes.find(n => n.id === hover.id)?.note;
  if (!hover || !note) return null;
  const via = new Map<string, number>();
  mapGraph.links.forEach(l => { if (l.source === note.id || l.target === note.id) l.shared.forEach(t => via.set(t, (via.get(t) || 0) + 1)); });
  const terms = Array.from(via).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
  const left = hover.x + 18 + CARD_W < boxWidth ? hover.x + 18 : Math.max(4, hover.x - 18 - CARD_W);
  const top = hover.y - 140 > 4 ? hover.y - 140 : hover.y + 20;
  return { note, terms, left, top, width: CARD_W };
}

// Selected-note panel: the note and every note it links to, most shared terms first.
function selectedOf(sel: string | null, gmap: Graph) {
  const note = gmap.nodes.find(n => n.id === sel)?.note;
  if (!note) return null;
  const related = gmap.links.flatMap(l => {
    const other = l.source === note.id ? l.target : l.target === note.id ? l.source : null;
    const o = other ? gmap.nodes.find(n => n.id === other)?.note : null;
    return o ? [{ other: o, shared: l.shared }] : [];
  }).sort((a, b) => b.shared.length - a.shared.length);
  return { note, related };
}

// Used by: useNotesPage. Returns graph data for GraphView plus hoverCard / selected / connectedCount for the page.
export function useMapView(o: MapOpts) {
  const [serverGraph, setServerGraph] = useState<Graph | null>(null);
  const [reloadKey, setReloadKey] = useState(0); // refetches the map after mutations
  const [hover, setHover] = useState<Hover | null>(null);
  const mapBox = useRef<HTMLDivElement>(null);

  // The map needs every node, so it's fetched only while the map is open.
  useEffect(() => {
    if (o.view !== "map") return;
    let live = true;
    api("/map").then(
      r => {
        if (!live || !Array.isArray(r?.nodes)) return;
        setServerGraph({
          nodes: r.nodes.map((n: ApiNode) => ({
            id: n.id, note: { id: n.id, raw_text: "", title: n.title, type: n.type, summary: n.summary, color: n.color || "" }, deg: n.deg, r: n.r,
          })),
          links: Array.isArray(r.edges) ? r.edges : [],
        });
      },
      () => { if (live) setServerGraph(null); },
    );
    return () => { live = false; };
  }, [o.view, reloadKey]);

  const gmap = useMemo(() => serverGraph ?? buildGraph(o.items), [serverGraph, o.items]); // offline → loaded notes
  // While searching, the map shows only the hits (and edges among them), not the whole graph dimmed.
  const visibleKey = o.searchRows.map(n => n.id).join(",");
  const mapGraph = useMemo(
    () => (o.scoped ? subgraph(gmap, visibleKey ? visibleKey.split(",") : []) : gmap),
    [o.scoped, gmap, visibleKey],
  );
  const mapNodes = useMemo(
    () => mapGraph.nodes.map(n => ({
      id: n.id, title: n.note.title || n.note.raw_text.slice(0, 60), type: (n.note.type || "note") as NoteType,
      color: nodeColor(n.note.color, n.note.type), deg: n.deg, r: n.r,
    })),
    [mapGraph],
  );

  // GraphView reports hover enter (id + position) and leave (null).
  const onHover = (id: string | null, x: number, y: number) => setHover(id ? { id, x, y } : null);
  // Bumping the key re-runs the /map fetch (only while the map is open).
  const refetch = () => setReloadKey(k => k + 1);
  // Map nodes carry their own copy of the note — repaint them now, not after the /map refetch.
  const patch = (id: string, p: Partial<Note>) =>
    setServerGraph(g => g && ({ ...g, nodes: g.nodes.map(n => (n.id === id ? { ...n, note: { ...n.note, ...p } } : n)) }));

  return {
    mapBox, gmap, mapGraph, mapNodes, onHover, refetch, patch,
    hoverCard: hoverCardOf(hover, gmap, mapGraph, mapBox.current?.clientWidth || 640),
    selected: selectedOf(o.sel, gmap),
    connectedCount: mapGraph.nodes.filter(n => n.deg > 0).length,
  };
}
