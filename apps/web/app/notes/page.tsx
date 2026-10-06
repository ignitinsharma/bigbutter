"use client";
// notes page: the whole app — stream list + map, search, voice tiers, infinite scroll.
// Markup only: every bit of state and logic lives in ./hooks (useNotesPage wires them together).
import NoteInput from "../../components/NoteInput";
import NoteBoard from "../../components/NoteBoard";
import NoteDialog from "../../components/NoteDialog";
import FilterChips from "../../components/FilterChips";
import BucketChips from "../../components/BucketChips";
import GraphView from "../../components/GraphView";
import Notice from "../../components/Notice";
import Navbar from "../../components/Navbar";
import SortMenu from "../../components/SortMenu";
import { I } from "../../components/IconButton";
import TypePill from "../../components/TypePill";
import { noteSurface } from "../../lib/colors";
import { BATCH, SKELETON_HEIGHTS } from "./constants";
import { useNotesPage } from "./hooks/useNotesPage";

export default function Notes() {
  const p = useNotesPage();
  const { view: v, feed, search, map, voice, stats, edits, actions, dialog } = p;
  const dn = dialog.dialogNote;

  const empty = (title: string, body: string, cta?: boolean) => (
    <div className="anim-enter rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      <svg className="mx-auto mb-4 text-primary" width="72" height="56" viewBox="0 0 72 56" fill="none" aria-hidden>
        <rect x="14" y="6" width="44" height="44" rx="10" fill="var(--primary-50)" stroke="var(--primary-100)" strokeWidth="1.5" />
        <path d="M24 20h24M24 28h18M24 36h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".7" />
        <circle cx="60" cy="12" r="3" fill="currentColor" opacity=".35" /><circle cx="8" cy="42" r="2" fill="currentColor" opacity=".3" />
      </svg>
      <h2 className="text-[18px]">{title}</h2>
      <p className="text-sm text-muted mt-1.5 max-w-sm mx-auto">{body}</p>
      {cta && <button onClick={p.focusInput} className="btn btn-primary h-9 px-4 text-[13px] mt-5">Write your first note</button>}
    </div>
  );

  return (
    <div data-theme={p.theme} className="min-h-screen text-ink"
      style={{ background: "radial-gradient(1200px 500px at 50% -10%, var(--primary-50), transparent 70%), var(--page)" }}>
      <div className="max-w-[1200px] mx-auto sm:px-5 sm:py-6">
        <div className="bg-bg sm:rounded-2xl sm:border border-line min-h-screen sm:min-h-0 shadow-[0_20px_50px_-24px_rgb(var(--shadow)/.22)]">
          <Navbar notes={stats.total} links={stats.connections} query={v.query} setQuery={v.changeQuery}
            theme={p.theme} onToggleTheme={p.toggleTheme} email={p.email} onLogout={p.logout} />
          <main className="px-4 sm:px-6 pt-5 pb-8">
            {p.notice && <Notice text={p.notice} onDismiss={p.dismissNotice}
              action={voice.retryId ? { label: voice.transcribing ? "Retrying…" : "Retry", onClick: voice.retryTranscribe, disabled: voice.transcribing } : undefined} />}

            <section aria-label="New note" className="anim-pop max-w-[680px] mx-auto">
              <NoteInput ref={p.input} draft={p.text} setDraft={p.setText} onSave={p.saver.save} busy={p.saver.busy}
                listening={voice.listening} transcribing={voice.transcribing} stream={voice.micStream}
                onToggleSpeak={voice.toggleSpeak} onCancelVoice={voice.cancelVoice} />
            </section>

            <div ref={v.listTop} className="scroll-anchor mt-5 mb-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="seg shrink-0 self-start" role="tablist" aria-label="View">
                <span className="seg-pill" aria-hidden
                  style={{ width: "calc(50% - 3px)", transform: v.view === "map" ? "translateX(100%)" : "none" }} />
                {(["stream", "map"] as const).map(x => (
                  <button key={x} role="tab" aria-selected={v.view === x} onClick={() => v.setView(x)}
                    className={`relative z-10 inline-flex items-center justify-center gap-2 px-4 h-8 rounded-[7px] text-[13px] font-medium capitalize transition-colors duration-200 ${v.view === x ? "text-ink" : "text-muted hover:text-soft"}`}>
                    {x === "stream" ? I.list : I.map}{x}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex-1 min-w-0">
                  {stats.total > 0 && <FilterChips counts={stats.counts} total={stats.total} active={v.filter} onPick={v.toggleFilter} />}
                </div>
                {v.view === "stream" && <div className="shrink-0"><SortMenu sort={v.sort} onSort={v.changeSort} /></div>}
              </div>
            </div>
            {v.view === "stream" && stats.total > 0 && !!stats.bucket_names?.length && (
              <div className="-mt-1 mb-4">
                <BucketChips names={stats.bucket_names} counts={stats.buckets || {}} active={v.bucket}
                  onPick={v.changeBucket} onSave={actions.saveBuckets} />
              </div>
            )}

            {v.view === "map" ? (
              stats.total === 0 && !feed.loading ? empty("No notes to map", "Save a note first. The map draws itself from the tags and people your notes share.", true) :
              search.scoped && map.mapGraph.nodes.length === 0 && search.searching ? <div className="skeleton h-[340px] rounded-[14px]" aria-busy="true" aria-label="Searching" /> :
              search.scoped && map.mapGraph.nodes.length === 0 ? empty("No notes found", `Nothing on the map matches "${search.qRaw}". Clear the search to see the whole map.`) : (
                <div ref={map.mapBox} className="relative anim-fade">
                  <GraphView nodes={map.mapNodes} links={map.mapGraph.links} sel={v.sel} onSelect={v.setSel} fit={search.scoped} onHover={map.onHover} />
                  {map.hoverCard && (
                    <div className="anim-enter absolute z-10 card p-3 pointer-events-none shadow-[0_12px_32px_-12px_rgb(var(--shadow)/.3)]"
                      style={{ left: map.hoverCard.left, top: map.hoverCard.top, width: map.hoverCard.width, ...noteSurface(map.hoverCard.note) }}>
                      <div className="mb-1.5"><TypePill type={map.hoverCard.note.type} size="sm" /></div>
                      <h2 className="text-[15px] leading-snug">{map.hoverCard.note.title || map.hoverCard.note.raw_text.slice(0, 60)}</h2>
                      {map.hoverCard.note.summary && <p className="text-xs text-soft mt-1 line-clamp-2">{map.hoverCard.note.summary}</p>}
                      {!!map.hoverCard.terms.length && <p className="text-[11.5px] text-muted mt-1.5">Linked via <span className="text-primary">{map.hoverCard.terms.join(", ")}</span></p>}
                    </div>
                  )}
                  <p className="text-xs text-muted mt-3">
                    {search.scoped && <>Showing {map.mapGraph.nodes.length} of {map.gmap.nodes.length} notes for this search. </>}
                    {map.connectedCount} of {map.mapGraph.nodes.length} notes connected by {map.mapGraph.links.length} links. Drag to rearrange, tap a note to trace it.
                  </p>
                  {map.selected && (
                    <div key={map.selected.note.id} className="anim-enter card on-tint p-5 mt-3" style={noteSurface(map.selected.note)}>
                      <div className="flex items-start gap-3">
                        <h2 className="flex-1 min-w-0 text-[18px]">{map.selected.note.title || map.selected.note.raw_text.slice(0, 60)}</h2>
                        <button onClick={() => actions.openNote(map.selected!.note.id)} className="btn btn-ghost h-8 px-3 text-[13px] shrink-0">{I.edit} Open note</button>
                      </div>
                      {map.selected.note.summary && <p className="text-sm text-soft mt-1">{map.selected.note.summary}</p>}
                      {map.selected.related.length ? (
                        <div className="mt-3">
                          <p className="text-[13px] text-soft font-medium mb-1">Connected to</p>
                          {map.selected.related.map(x => (
                            <button key={x.other.id} className="block w-full text-left py-1.5 px-1 -mx-1 rounded-md hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] transition-colors" onClick={() => v.setSel(x.other.id)}>
                              <span className="text-[13.5px] text-primary">{x.other.title}</span>
                              <span className="text-xs text-faint"> via {x.shared.join(", ")}</span>
                            </button>
                          ))}
                        </div>
                      ) : <p className="text-sm text-faint mt-2">Nothing else touches this yet.</p>}
                    </div>
                  )}
                </div>
              )
            ) : feed.loading || (!search.scoped && feed.listLoading) || (search.scoped && search.searching && p.shown.length === 0) ? (
              <div className="columns-1 min-[560px]:columns-2 min-[860px]:columns-3 min-[1100px]:columns-4 gap-3" aria-busy="true" aria-label={search.scoped ? "Searching" : "Loading notes"}>
                {SKELETON_HEIGHTS.map((h, i) => <div key={i} className="skeleton rounded-xl mb-3 break-inside-avoid" style={{ height: h }} />)}
              </div>
            ) : !search.scoped && v.filter === "all" && !v.bucket && feed.items.length === 0 && !feed.hasMore ? (
              empty("No notes yet", "Type a thought above, or tap the mic and say it. Each note gets a title, tags and connections.", true)
            ) : p.shown.length === 0 ? (
              empty("No notes found", search.scoped ? `Nothing matches "${search.qRaw}". Try another word, or clear the filter.` : v.bucket ? `Nothing in ${v.bucket}${v.filter !== "all" ? " of this type" : ""} yet.` : "No notes of this type yet.")
            ) : (
              <>
                {search.searching && (
                  <p className="anim-fade mb-3 flex items-center gap-2 text-[13px] text-primary" role="status">
                    {I.sparkle} Searching with AI<span className="w-1.5 h-1.5 rounded-full bg-primary pulse" aria-hidden />
                  </p>
                )}
                {search.summary && (
                  <div className="anim-enter rounded-xl bg-primary-50 border border-primary-100 px-4 py-3 mb-3 flex gap-2.5">
                    <span className="text-primary mt-0.5">{I.sparkle}</span>
                    <p className="text-sm text-soft">{search.summary}</p>
                  </div>
                )}
                <NoteBoard key={`${v.filter}|${v.bucket ?? ""}|${v.sort}|${search.scoped ? "q" : ""}`} notes={p.shown} batch={BATCH} sel={v.sel} highlightIds={search.matched}
                  refreshing={p.refreshing} palette={p.palette.palette}
                  onOpen={actions.openNote}
                  onSetColor={edits.setColor}
                  onSetType={edits.setType}
                  onAddCustom={p.palette.addCustom} onRemoveCustom={p.palette.removeCustom}
                  onCopy={actions.copyNote}
                  onDelete={actions.remove} />
                {!search.scoped && (
                  <div ref={feed.sentinel} className="mt-6 min-h-px">
                    {feed.loadingMore ? (
                      <div className="grid grid-cols-1 min-[560px]:grid-cols-2 min-[860px]:grid-cols-3 min-[1100px]:grid-cols-4 gap-3" aria-busy="true" aria-label="Loading more notes">
                        {[0, 1, 2, 3].map(i => <div key={i} className={`skeleton rounded-xl h-[120px] ${i ? "hidden min-[560px]:block" : ""}`} />)}
                      </div>
                    ) : feed.moreErr ? (
                      <p className="text-center text-[13px] text-muted" role="status">
                        Couldn't load more notes.{" "}
                        <button onClick={feed.loadMore} className="btn btn-ghost h-8 px-3 text-[13px] ml-1">Retry</button>
                      </p>
                    ) : !feed.hasMore && feed.items.length > BATCH ? (
                      <p className="text-center text-xs text-faint" role="status">That's all {feed.items.length} notes.</p>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>
      {dn && (
        <NoteDialog key={dn.id} note={dn} palette={p.palette.palette} buckets={stats.bucket_names || []} refreshing={p.refreshing.has(dn.id)}
          onDone={actions.closeNote}
          onSetColor={c => edits.setColor(dn.id, c)}
          onSetType={t => edits.setType(dn.id, t)}
          onSetTags={tags => edits.setTags(dn.id, tags)}
          onSetBucket={b => edits.setBucket(dn.id, b)}
          onRegenerate={() => edits.regenerate(dn)}
          onDelete={() => actions.remove(dn.id)}
          onTag={v.changeQuery}
          onNotice={p.setNotice}
          onAddCustom={p.palette.addCustom} onRemoveCustom={p.palette.removeCustom} />
      )}
    </div>
  );
}
