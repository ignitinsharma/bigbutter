"use client";

import { useEffect, useRef } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter,
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
  color: string;
  deg: number;
  r: number;
  lines: string[];
  w: number;   // label-aware box: circle + wrapped title underneath
  h: number;
  oy: number;  // box centre relative to the node centre
};

type GLink = { source: string | GNode; target: string | GNode; shared: string[]; weight: number; tw: number };

// ponytail: module cache keeps node positions across renders, like the prototype
const pos: Record<string, { x: number; y: number }> = {};

type Props = {
  nodes: { id: string; title: string; type: keyof typeof TYPES; color: string; deg: number; r: number }[];
  links: GraphLink[];
  sel: string | null;
  onSelect: (id: string | null) => void;
  focusIds?: string[] | null;
  fit?: boolean; // search subgraph: zoom the viewBox onto the nodes once the layout settles
  onHover?: (id: string | null, x: number, y: number) => void;
};

const FONT = 11.5, LINE = 14, MAX_CH = 22, PAD = 8, DIM = 0.35;

// Word-wrap a title into at most 2 lines of ~MAX_CH chars; only the overflow gets "…".
function wrap(title: string): string[] {
  const fit = (w: string) => (w.length > MAX_CH ? w.slice(0, MAX_CH - 1) + "…" : w);
  const lines: string[] = [];
  let cur = "";
  const words = title.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (next.length <= MAX_CH) { cur = next; continue; }
    if (cur) lines.push(cur);
    if (lines.length === 2) { // out of room: mark the cut on the last line
      lines[1] = lines[1].endsWith("…") ? lines[1] : (lines[1].length >= MAX_CH ? lines[1].slice(0, MAX_CH - 1) : lines[1]) + "…";
      return lines;
    }
    cur = fit(words[i]);
  }
  if (cur) lines.push(cur);
  return lines;
}

// Rectangle collision: push overlapping label boxes apart along their shallower overlap.
function rectCollide(nodes: GNode[], strength = 1) {
  return () => {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = (b.x! + b.vx!) - (a.x! + a.vx!) || (Math.random() - 0.5) * 0.1;
      const dy = (b.y! + b.oy + b.vy!) - (a.y! + a.oy + a.vy!) || (Math.random() - 0.5) * 0.1;
      const ox = (a.w + b.w) / 2 + PAD - Math.abs(dx);
      const oy = (a.h + b.h) / 2 + PAD - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) { const m = (ox / 2) * strength * Math.sign(dx); a.vx! -= m; b.vx! += m; }
      else { const m = (oy / 2) * strength * Math.sign(dy); a.vy! -= m; b.vy! += m; }
    }
  };
}

const end = (v: string | GNode) => (typeof v === "object" ? v.id : v);

export default function GraphView({ nodes, links, sel, onSelect, focusIds, fit, onHover }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const cbRef = useRef(onSelect);
  cbRef.current = onSelect;
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const hlRef = useRef<((id: string | null) => void) | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || nodes.length === 0) return;
    const w = el.clientWidth || 640;
    el.innerHTML =
      `<svg width="100%" height="400" viewBox="0 0 ${w} 400">` +
      `<defs><pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">` +
      `<circle cx="1" cy="1" r="0.7" style="fill:var(--line-strong)"/></pattern></defs>` +
      `<rect x="${-w * 3}" y="-3000" width="${w * 7}" height="7000" fill="url(#grid)"/>` +
      `<g id="edges"></g><g id="elabels"></g><g id="nodes"></g></svg>`;

    const svg = el.querySelector("svg")!;
    svg.onclick = () => cbRef.current(null);
    svg.onmouseleave = () => hoverRef.current?.(null, 0, 0);

    const simNodes: GNode[] = nodes.map(n => {
      const p = pos[n.id];
      return { ...n, x: p?.x, y: p?.y, lines: wrap(n.title || "Untitled"), w: 0, h: 0, oy: 0 };
    });
    const simLinks: GLink[] = links.map(l => ({ ...l, tw: 0 }));

    const halo = (s: ReturnType<typeof select<SVGTextElement, unknown>>) => s
      .style("stroke", "var(--surface)").style("stroke-width", "3px").style("stroke-linejoin", "round").style("paint-order", "stroke");

    // Nodes + labels first, so label widths can be measured before the layout runs.
    const nodeG = select(svg).select("#nodes").selectAll<SVGGElement, GNode>("g").data(simNodes).join("g").style("cursor", "grab");
    nodeG.append("circle")
      .attr("r", d => d.r)
      .style("fill", d => (d.deg ? d.color : `color-mix(in srgb, ${d.color} 16%, var(--bg))`))
      .style("stroke", d => d.color).attr("stroke-width", 1.5);
    const label = nodeG.append("text")
      .attr("text-anchor", "middle").attr("font-size", FONT).style("fill", "var(--soft)")
      .style("pointer-events", "none").style("font-family", "Geist,sans-serif").style("font-weight", "500");
    label.each(function (d) {
      const t = select(this);
      d.lines.forEach((ln, i) => t.append("tspan").attr("x", 0).attr("y", d.r + 14 + i * LINE).text(ln));
      halo(t as never);
    });
    label.each(function (d) {
      let lw = 0;
      this.querySelectorAll("tspan").forEach(ts => { lw = Math.max(lw, (ts as SVGTextContentElement).getComputedTextLength()); });
      d.w = Math.max(d.r * 2, lw) + 6;
      const top = -d.r - 2, bottom = d.r + 6 + d.lines.length * LINE;
      d.h = bottom - top;
      d.oy = (top + bottom) / 2;
    });

    // Canvas grows with what it has to hold (label boxes × breathing room).
    const area = simNodes.reduce((s, d) => s + (d.w + PAD * 2) * (d.h + PAD * 2), 0);
    const h = Math.round(Math.max(380, Math.min(1000, (area * 3.5) / w)));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    const sim: Simulation<GNode, undefined> = forceSimulation(simNodes)
      .force("link", forceLink<GNode, GLink>(simLinks).id(d => d.id)
        .distance(d => 120 - Math.min(40, d.weight * 12))
        .strength(d => Math.min(0.7, 0.2 + d.weight * 0.15)))
      .force("charge", forceManyBody().strength(-260))
      .force("center", forceCenter(w / 2, h / 2))
      .force("boxes", rectCollide(simNodes))
      .alpha(0.9);

    const edgeSel = select(svg).select("#edges").selectAll("line").data(simLinks).join("line")
      .style("stroke", "var(--line-strong)").attr("stroke-width", d => Math.min(4, d.weight * 1.3));

    // Edge label = the strongest shared term, as a pill; only shown for the focused node's edges.
    const pill = select(svg).select("#elabels").selectAll<SVGGElement, GLink>("g").data(simLinks).join("g")
      .style("pointer-events", "none").attr("opacity", 0);
    pill.append("rect").attr("height", 16).attr("rx", 8).attr("y", -8)
      .style("fill", "var(--bg)").style("stroke", "var(--primary-100)");
    pill.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").attr("font-size", 10.5)
      .style("fill", "var(--primary)").style("font-family", "Geist,sans-serif").style("font-weight", "500")
      .text(d => d.shared[0] || "");
    pill.each(function (d) {
      d.tw = (this.querySelector("text") as SVGTextContentElement).getComputedTextLength() + 12;
      select(this).select("rect").attr("width", d.tw).attr("x", -d.tw / 2);
    });

    const rel = (ev: { clientX: number; clientY: number }) => {
      const box = el.getBoundingClientRect();
      return { x: ev.clientX - box.left, y: ev.clientY - box.top };
    };

    let hl: string | null = null;
    // A pill fits only if the visible edge (minus both circles) is longer than the pill.
    const pillOn = (d: GLink) => {
      if (!hl || (end(d.source) !== hl && end(d.target) !== hl)) return 0;
      const a = d.source as GNode, b = d.target as GNode;
      const len = Math.hypot(b.x! - a.x!, b.y! - a.y!) - a.r - b.r;
      return len > d.tw + 8 ? 1 : 0;
    };
    function highlight(id: string | null) {
      hl = id;
      if (!id) { nodeG.attr("opacity", 1); edgeSel.attr("opacity", 1); pill.attr("opacity", 0); return; }
      const near = new Set([id]);
      simLinks.forEach(l => { const a = end(l.source), b = end(l.target); if (a === id) near.add(b); if (b === id) near.add(a); });
      nodeG.attr("opacity", d => (near.has(d.id) ? 1 : DIM));
      edgeSel.attr("opacity", d => (end(d.source) === id || end(d.target) === id ? 1 : 0.12));
      pill.attr("opacity", pillOn);
    }
    hlRef.current = highlight;

    nodeG
      .on("click", (ev, d) => { ev.stopPropagation(); cbRef.current(selRef.current === d.id ? null : d.id); })
      .on("pointerenter", (ev, d) => { d.fx = d.x; d.fy = d.y; highlight(d.id); const p = rel(ev); hoverRef.current?.(d.id, p.x, p.y); })
      .on("pointermove", (ev, d) => { const p = rel(ev); hoverRef.current?.(d.id, p.x, p.y); })
      .on("pointerleave", (_ev, d) => { d.fx = null; d.fy = null; sim.alpha(0.2).restart(); highlight(selRef.current); hoverRef.current?.(null, 0, 0); })
      .call(drag<SVGGElement, GNode>()
        .on("start", (ev, d) => { hoverRef.current?.(null, 0, 0); sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on("end", (ev, d) => { sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    sim.on("tick", () => {
      simNodes.forEach(n => {
        // keep the whole label box on the canvas, not just the circle
        n.x = Math.max(n.w / 2 + 4, Math.min(w - n.w / 2 - 4, n.x ?? w / 2));
        n.y = Math.max(n.r + 6, Math.min(h - (n.oy + n.h / 2) - 4, n.y ?? h / 2));
        pos[n.id] = { x: n.x, y: n.y };
      });
      edgeSel
        .attr("x1", d => (d.source as GNode).x!).attr("y1", d => (d.source as GNode).y!)
        .attr("x2", d => (d.target as GNode).x!).attr("y2", d => (d.target as GNode).y!);
      pill.attr("transform", d => `translate(${((d.source as GNode).x! + (d.target as GNode).x!) / 2},${((d.source as GNode).y! + (d.target as GNode).y!) / 2})`);
      if (hl) pill.attr("opacity", pillOn);
      nodeG.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    if (fit) {
      let done = false;
      sim.on("end.fit", () => {
        if (done) return;
        done = true;
        const pad = 40;
        const x0 = Math.min(...simNodes.map(d => d.x! - d.w / 2)) - pad, x1 = Math.max(...simNodes.map(d => d.x! + d.w / 2)) + pad;
        const y0 = Math.min(...simNodes.map(d => d.y! + d.oy - d.h / 2)) - pad, y1 = Math.max(...simNodes.map(d => d.y! + d.oy + d.h / 2)) + pad;
        // never zoom in past 1.6× (a lone node shouldn't fill the canvas); keep the canvas aspect
        const s = Math.max((x1 - x0) / w, (y1 - y0) / h, 1 / 1.6);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        svg.setAttribute("viewBox", `${cx - (w * s) / 2} ${cy - (h * s) / 2} ${w * s} ${h * s}`);
      });
    }

    if (selRef.current) highlight(selRef.current);
    else if (focusIds && focusIds.length) {
      const keep = new Set(focusIds);
      nodeG.attr("opacity", d => (keep.has(d.id) ? 1 : 0.25));
    }
    return () => { sim.stop(); hlRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, fit, JSON.stringify(focusIds)]);

  // re-highlight when the selection changes without rebuilding the sim
  useEffect(() => { hlRef.current?.(sel); }, [sel]);

  return <div id="map" ref={host} className="card bg-surface overflow-hidden" style={{ touchAction: "none" }} />;
}
