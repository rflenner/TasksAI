"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { findDuplicateSuggestions } from "../lib/duplicate-match";
import "../users/users.css";
import "./data-hygiene.css";

type DimensionType = "project" | "meeting" | "topic" | "person";
type DimensionRow = { id: number; type: DimensionType; value: string; usageCount: number; firstUsed: string | null; lastActivity: string | null; isRegisteredUser: boolean };
const TYPE_LABEL: Record<DimensionType, string> = { project: "Projects", meeting: "Recurring meetings", topic: "Topics", person: "People" };
const TYPE_ORDER: DimensionType[] = ["person", "project", "meeting", "topic"];

function formatActivity(iso: string | null) {
  if (!iso) return "No known activity";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Active just now";
  if (minutes < 60) return `Active ${minutes}m ago`;
  if (minutes < 1440) return `Active ${Math.round(minutes / 60)}h ago`;
  if (minutes < 43200) return `Active ${Math.round(minutes / 1440)}d ago`;
  return `Last active ${formatDate(iso)}`;
}

// DD.MM.YYYY — task.created is either a full ISO timestamp or a bare
// YYYY-MM-DD string depending on how the task was made (see
// app/lib/data-hygiene.ts's usageStats), so parse defensively: take just
// the date portion rather than trusting new Date() on every shape.
function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function statsLine(row: DimensionRow, type: DimensionType) {
  const parts = [`${row.usageCount} task slot${row.usageCount === 1 ? "" : "s"}`];
  if (row.firstUsed) parts.push(`In use since ${formatDate(row.firstUsed)}`);
  if (type === "person") parts.push(formatActivity(row.lastActivity));
  return parts.join(" · ");
}

// initialDimensions comes from the server (page.tsx) — same reasoning as
// app/account/AccountClient.tsx's initialPasskeys: no fetch-on-mount effect,
// no loading flash, no hydration mismatch. This component only fetches
// again in response to an actual action (retag, remove).
export default function DataHygieneClient({ initialDimensions }: { initialDimensions: DimensionRow[] }) {
  const [dimensions, setDimensions] = useState<DimensionRow[]>(initialDimensions);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // Rename (edit this value's own text) and Merge (fold it into a
  // different, existing value) are separate actions with separate UI:
  // Rename edits the name in place; Merge opens a panel of ranked
  // candidates plus a search fallback. One pattern, not two — there used
  // to also be a standalone "possible duplicates" section up top doing a
  // similar-but-different flow; folding that into a per-row candidate
  // count on the Merge button itself means there's only one place this
  // ever happens.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [mergingId, setMergingId] = useState<number | null>(null);
  const [mergeSearch, setMergeSearch] = useState("");

  const byType = useMemo(() => {
    const groups: Record<DimensionType, DimensionRow[]> = { person: [], project: [], meeting: [], topic: [] };
    for (const row of dimensions) groups[row.type].push(row);
    for (const type of TYPE_ORDER) groups[type].sort((a, b) => a.value.localeCompare(b.value));
    return groups;
  }, [dimensions]);

  // One pairwise sweep per type, shared by both the Merge button's
  // candidate-count badge and the panel it opens — computed once, not
  // separately for each row (findDuplicateSuggestions is O(n²) per type).
  const dupPairsByType = useMemo(() =>
    Object.fromEntries(TYPE_ORDER.map(type => [type, findDuplicateSuggestions(type, byType[type].map(row => row.value))])) as Record<DimensionType, ReturnType<typeof findDuplicateSuggestions>>,
    [byType]);

  const candidatesFor = (row: DimensionRow) =>
    dupPairsByType[row.type]
      .filter(pair => pair.a === row.value || pair.b === row.value)
      .map(pair => ({ value: pair.a === row.value ? pair.b : pair.a, reason: pair.reason }));

  // Shared by every action that changes what a value's canonical spelling
  // is — renaming this row's own text or merging it into an existing one.
  // Both are the exact same server-side operation (see retagDimensionValue)
  // — this just wraps the fetch, the resulting state update, and the
  // notice text.
  const retag = async (type: DimensionType, from: string, to: string) => {
    if (!to || from === to || busy) return;
    setBusy(true);
    const response = await fetch("/api/data-hygiene/retag", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, from, to }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setNotice(data.error); return; }
    const existedAlready = dimensions.some(item => item.type === type && item.value === to);
    setDimensions(data.dimensions);
    setNotice(data.tasksUpdated || data.usersUpdated
      ? `"${from}" ${existedAlready ? "merged into" : "renamed to"} "${to}" — updated ${data.tasksUpdated} task slot${data.tasksUpdated === 1 ? "" : "s"}${data.usersUpdated ? ` and ${data.usersUpdated} user${data.usersUpdated === 1 ? "" : "s"}' access scope` : ""}.`
      : `"${from}" ${existedAlready ? "merged into" : "renamed to"} "${to}" — nothing currently used it, so no tasks changed.`);
  };

  const startRename = (row: DimensionRow) => { setMergingId(null); setRenamingId(row.id); setRenameDraft(row.value); setNotice(""); };
  const cancelRename = () => { setRenamingId(null); setRenameDraft(""); };
  const saveRename = async (row: DimensionRow) => {
    const to = renameDraft.trim();
    if (!to || to === row.value) { cancelRename(); return; }
    await retag(row.type, row.value, to);
    cancelRename();
  };

  const startMerge = (row: DimensionRow) => { setRenamingId(null); setMergingId(row.id); setMergeSearch(""); setNotice(""); };
  const cancelMerge = () => { setMergingId(null); setMergeSearch(""); };
  const mergeInto = async (row: DimensionRow, to: string) => {
    await retag(row.type, row.value, to);
    cancelMerge();
  };

  const removeSuggestion = async (row: DimensionRow) => {
    if (!window.confirm(`Remove "${row.value}" from the ${TYPE_LABEL[row.type].toLowerCase()} suggestion list? This only stops it being suggested — it won't change any task that already uses it.`)) return;
    const response = await fetch("/api/dimensions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: row.id }) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error); return; }
    setDimensions(items => items.filter(item => item.id !== row.id));
    setNotice(data.stillUsedByTasks ? `Removed "${row.value}" — but ${data.stillUsedByTasks} task${data.stillUsedByTasks === 1 ? " still uses" : "s still use"} it, so it'll come back unless you rename or merge ${data.stillUsedByTasks === 1 ? "that task" : "those tasks"} too.` : `Removed "${row.value}" from suggestions.`);
  };

  return (
    <main className="users-shell">
      <aside className="users-side">
        <Link className="users-logo" href="/">Task <b>AI</b></Link>
        <nav>
          <Link href="/">← Action items</Link>
          <Link href="/users">Users & access</Link>
          <Link className="active" href="/data-hygiene">Data Hygiene</Link>
          <Link href="/integrations">Integrations</Link>
          <Link href="/email-preview">Email notifications</Link>
        </nav>
      </aside>
      <section className="users-work">
        <header>
          <div>
            <span className="eyebrow">COMPANY SETTINGS</span>
            <h1>Data Hygiene</h1>
            <p>Merge or rename duplicate names, projects, meetings, and topics — every task and user scope that references the old value is updated to the new one, so nothing gets lost. A number on Merge means we spotted likely matches for it.</p>
          </div>
        </header>
        {notice && <button className="toast" onClick={() => setNotice("")}>{notice} ×</button>}

        {TYPE_ORDER.map(type => byType[type].length > 0 && (
          <section key={type}>
            <div className="section-title"><div><span className="eyebrow">{TYPE_LABEL[type].toUpperCase()}</span><h2>{TYPE_LABEL[type]}</h2></div><span>{byType[type].length}</span></div>
            <div className="user-list">
              {byType[type].map(row => {
                const candidates = candidatesFor(row);
                return (
                  <div key={row.id}>
                    <article className="hygiene-row">
                      <div className="identity">
                        {renamingId === row.id ? (
                          <div className="inline-edit">
                            <input aria-label={`Rename "${row.value}"`} className="inline-edit-input" value={renameDraft} onChange={e => setRenameDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void saveRename(row); if (e.key === "Escape") cancelRename(); }} />
                            <button className="manage" disabled={busy || !renameDraft.trim() || renameDraft.trim() === row.value} onClick={() => void saveRename(row)}>Save</button>
                            <button className="manage" onClick={cancelRename}>Cancel</button>
                          </div>
                        ) : (
                          <b>{row.value}{row.isRegisteredUser && <span className="badge badge-registered">Registered</span>}</b>
                        )}
                        <small>{statsLine(row, type)}</small>
                      </div>
                      <div className="row-actions">
                        <button className="manage" onClick={() => startRename(row)}>Rename</button>
                        <button className="manage" onClick={() => mergingId === row.id ? cancelMerge() : startMerge(row)}>
                          Merge{candidates.length > 0 && <span className="badge badge-count">{candidates.length}</span>}
                        </button>
                        <button className="manage" onClick={() => void removeSuggestion(row)}>Remove</button>
                      </div>
                    </article>
                    {mergingId === row.id && (
                      <div className="merge-panel">
                        <div className="hint">Merge &quot;{row.value}&quot; into:</div>
                        {candidates.length > 0 && (
                          <div className="merge-candidates">
                            {candidates.map(candidate => (
                              <button key={candidate.value} className="manage" disabled={busy} onClick={() => void mergeInto(row, candidate.value)}>
                                {candidate.value} <small>— {candidate.reason.toLowerCase()}</small>
                              </button>
                            ))}
                          </div>
                        )}
                        {candidates.length === 0 && <p className="hint">No close matches found automatically — search below instead.</p>}
                        <div className="merge-search">
                          <input aria-label={`Search ${TYPE_LABEL[type].toLowerCase()} to merge into`} list={`merge-search-${type}`} value={mergeSearch} onChange={e => setMergeSearch(e.target.value)} placeholder={`Search all ${TYPE_LABEL[type].toLowerCase()}…`} />
                          <datalist id={`merge-search-${type}`}>{byType[type].filter(item => item.id !== row.id).map(item => <option key={item.id} value={item.value} />)}</datalist>
                          <button className="manage" disabled={busy || !mergeSearch.trim() || mergeSearch.trim() === row.value} onClick={() => void mergeInto(row, mergeSearch.trim())}>Merge</button>
                          <button className="manage" onClick={cancelMerge}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {dimensions.length === 0 && <p className="hint">Nothing to clean up yet.</p>}
      </section>
    </main>
  );
}
