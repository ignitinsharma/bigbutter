"use client";

import { useEffect, useRef } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type Simulation, type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { drag } from "d3-drag";
import type { GraphLink } from "../lib/graph";
import { TYPES } from "../lib/types";

type GNode = SimulationNodeDatum & {
  id: string;
  title: string;
  type: keyof typeof TYPES;
  deg: number;
  r: number;
};

type GLink = { source: string | GNode; target: string | GNode; shared: string[]; weight: number };

// ponytail: module cache keeps node positions across renders, like the prototype
const pos: Record<string, { x: number; y: number }> = {};

type Props = {
  nodes: { id: string; title: string; type: keyof typeof TYPES; deg: number; r: number }[];
  links: GraphLink[];
  sel: string | null;
  onSelect: (id: string | null) => void;
  focusIds?: string[] | null;
  onHover?: (id: string | null, x: number, y: number) => void;
};

export default function GraphView({ nodes, links, sel, onSelect, focusIds, onHover }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const cbRef = useRef(onSelect);
  cbRef.current = onSelect;
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;

  useEffect(() => {
    const el = host.current;
    if (!el || nodes.length === 0) return;
    const w = el.clientWidth || 640;
    const h = Math.max(340, Math.min(520, w * 0.75));
    el.innerHTML =
      `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs><pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">` +
      `<circle cx="1" cy="1" r="0.7" fill="#DCD7CA"/></pattern></defs>` +
      `<rect width="${w}" height="${h}" fill="url(#grid)"/>` +
      `<g id="edges"></g><g id="nodes"></g></svg>`;

    const svg = el.querySelector("svg")!;
    svg.onclick = () => cbRef.current(null);

    const simNodes: GNode[] = nodes.map(n => {
      const p = pos[n.id];
      return { ...n, x: p?.x, y: p?.y };
    });
    const simLinks: GLink[] = links.map(l => ({ ...l }));

    const sim: Simulation<GNode, undefined> = forceSimulation(simNodes)
      .force("link", forceLink<GNode, GLink>(simLinks).id(d => d.id)
        .distance(d => 130 - Math.min(60, d.weight * 18))
        .strength(d => Math.min(0.85, 0.25 + d.weight * 0.18)))
      .force("charge", forceManyBody().strength(-300))
      .force("center", forceCenter(w / 2, h / 2))
      .force("collide", forceCollide<GNode>(d => d.r + 22))
      .alpha(0.9);

    const edges = select(svg).select("#edges");
    const nodeLayer = select(svg).select("#nodes");

    const edgeSel = edges.selectAll("line").data(simLinks).join("line")
      .attr("stroke", "#B3AB98").attr("stroke-width", d => Math.min(4, d.weight * 1.3));

    const labelSel = edges.selectAll("text").data(simLinks).join("text")
      .attr("font-size", 10.5).attr("fill", "#8A5A00").attr("text-anchor", "middle")
      .style("pointer-events", "none").style("font-family", "Inter,sans-serif")
      .text(d => d.shared.slice(0, 2).join(" · ")).attr("opacity", 0);

    const rel = (ev: { clientX: number; clientY: number }) => {
      const box = el.getBoundingClientRect();
      return { x: ev.clientX - box.left, y: ev.clientY - box.top };
    };

    const nodeG = nodeLayer.selectAll("g").data(simNodes).join("g").style("cursor", "grab")
      .on("click", (ev, d) => { ev.stopPropagation(); cbRef.current(selRef.current === d.id ? null : d.id); })
      .on("pointerenter", (ev, d) => { highlight(d.id); const p = rel(ev); hoverRef.current?.(d.id, p.x, p.y); })
      .on("pointermove", (ev, d) => { const p = rel(ev); hoverRef.current?.(d.id, p.x, p.y); })
      .on("pointerleave", () => { highlight(selRef.current); hoverRef.current?.(null, 0, 0); })
      .call(drag<SVGGElement, GNode>()
        .on("start", (ev, d) => { sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on("end", (ev, d) => { sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    nodeG.append("circle")
      .attr("r", d => d.r)
      .attr("fill", d => (d.deg ? TYPES[d.type].hue : TYPES[d.type].bg))
      .attr("stroke", d => TYPES[d.type].hue).attr("stroke-width", 1.5);

    nodeG.append("text")
      .attr("text-anchor", "middle").attr("font-size", 11.5).attr("fill", "#413B31")
      .style("pointer-events", "none").style("font-family", "Inter,sans-serif")
      .attr("dy", d => d.r + 14)
      .text(d => (d.title.length > 24 ? d.title.slice(0, 23) + "…" : d.title));

    function highlight(id: string | null) {
      if (!id) { nodeG.attr("opacity", 1); edgeSel.attr("opacity", 1); labelSel.attr("opacity", 0); return; }
      const near = new Set([id]);
      simLinks.forEach(l => {
        const a = typeof l.source === "object" ? (l.source as GNode).id : l.source;
        const b = typeof l.target === "object" ? (l.target as GNode).id : l.target;
        if (a === id) near.add(b); if (b === id) near.add(a);
      });
      nodeG.attr("opacity", d => (near.has(d.id) ? 1 : 0.15));
      edgeSel.attr("opacity", d => {
        const a = typeof d.source === "object" ? (d.source as GNode).id : d.source;
        const b = typeof d.target === "object" ? (d.target as GNode).id : d.target;
        return near.has(a) && near.has(b) ? 1 : 0.1;
      });
      labelSel.attr("opacity", d => {
        const a = typeof d.source === "object" ? (d.source as GNode).id : d.source;
        const b = typeof d.target === "object" ? (d.target as GNode).id : d.target;
        return a === id || b === id ? 1 : 0;
      });
    }

    sim.on("tick", () => {
      simNodes.forEach(n => {
        n.x = Math.max(n.r + 6, Math.min(w - n.r - 6, n.x ?? w / 2));
        n.y = Math.max(n.r + 6, Math.min(h - n.r - 18, n.y ?? h / 2));
        pos[n.id] = { x: n.x, y: n.y };
      });
      edgeSel
        .attr("x1", d => (d.source as GNode).x!).attr("y1", d => (d.source as GNode).y!)
        .attr("x2", d => (d.target as GNode).x!).attr("y2", d => (d.target as GNode).y!);
      labelSel
        .attr("x", d => ((d.source as GNode).x! + (d.target as GNode).x!) / 2)
        .attr("y", d => ((d.source as GNode).y! + (d.target as GNode).y!) / 2 - 5);
      nodeG.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    if (selRef.current) highlight(selRef.current);
    else if (focusIds && focusIds.length) {
      const keep = new Set(focusIds);
      nodeG.attr("opacity", d => (keep.has(d.id) ? 1 : 0.25));
    }
    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, JSON.stringify(focusIds)]);

  // re-highlight when selection changes without rebuilding the sim
  useEffect(() => {
    const el = host.current?.querySelector("svg");
    if (!el) return;
    const svg = select(el);
    if (!sel) { svg.select("#nodes").selectAll("g").attr("opacity", 1); svg.select("#edges").selectAll("line").attr("opacity", 1); svg.select("#edges").selectAll("text").attr("opacity", 0); }
  }, [sel]);

  return <div id="map" ref={host} className="rounded bg-card border border-line overflow-hidden" style={{ touchAction: "none" }} />;
}
