"use client";

type Props = { page: number; pages: number; total: number; per: number; onPage: (p: number) => void };

// 1 … 4 5 6 … 12 — first, last, and a window around the current page.
function range(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  let lo = Math.max(2, page - 1);
  let hi = Math.min(pages - 1, page + 1);
  // Near an end, show the run of pages instead of a gap that hides just one.
  if (page <= 4) { lo = 2; hi = Math.max(hi, 5); }
  if (page >= pages - 3) { hi = pages - 1; lo = Math.min(lo, pages - 4); }
  if (lo > 2) out.push("gap");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pages - 1) out.push("gap");
  out.push(pages);
  return out;
}

export default function Pagination({ page, pages, total, per, onPage }: Props) {
  if (!total) return null;
  const from = (page - 1) * per + 1;
  const to = Math.min(page * per, total);
  const sq = "btn h-9 min-w-9 px-2 text-[13px] tabular-nums rounded-[10px]";
  const arrow = `${sq} btn-ghost w-9`;
  return (
    <nav aria-label="Pagination" className="mt-6 flex flex-col items-center gap-2.5">
      {pages > 1 && (
        <div className="flex items-center gap-1.5">
          <button className={`${arrow} mr-2`} onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {range(page, pages).map((p, i) => p === "gap" ? (
            <span key={`g${i}`} className="w-6 text-center text-faint select-none">…</span>
          ) : (
            <button key={p} onClick={() => onPage(p)} aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined}
              className={`${sq} ${p === page ? "btn-primary" : "text-soft hover:bg-surface"}`}>
              {p}
            </button>
          ))}
          <button className={`${arrow} ml-2`} onClick={() => onPage(page + 1)} disabled={page === pages} aria-label="Next page">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      )}
      <p className="text-[13px] text-muted tabular-nums">Showing {from}–{to} of {total} {total === 1 ? "note" : "notes"}</p>
    </nav>
  );
}
