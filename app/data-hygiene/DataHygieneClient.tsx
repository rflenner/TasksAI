"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { findDuplicateSuggestions } from "../lib/duplicate-match";
import "../users/users.css";

type DimensionType = "project" | "meeting" | "topic" | "person";
type DimensionRow = { id: number; type: DimensionType; value: string; usageCount: number; lastActivity: string | null };
const TYPE_LABEL: Record<DimensionType, string> = { project: "Projects", meeting: "Recurring meetings", topic: "Topics", person: "People" };
const TYPE_ORDER: DimensionType[] = ["person", "project", "meeting", "topic"];

function formatActivity(iso: string | null) {
  if (!iso) return "No known activity";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Active just now";
  if (minutes < 60) return `Active ${minutes}m ago`;
  if (minutes < 1440) return `Active ${Math.round(minutes / 60)}h ago`;
  if (minutes < 43200) return `Active ${Math.round(minutes / 1440)}d ago`;
  return `Last active ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

const pairKey = (type: DimensionType, a: string, b: string) => `${type}|${a}|${b}`;

// initialDimensions comes from the server (page.tsx) — same reasoning as
// app/account/AccountClient.tsx's initialPasskeys: no fetch-on-mount effect,
// no loading flash, no hydration mismatch. This component only fetches
// again in response to an actual action (retag, remove).
export default function DataHygieneClient({ initialDimensions }: { initialDimensions: DimensionRow[] }) {
  const [dimensions, setDimensions] = useState<DimensionRow[]>(initialDimensions);
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Dismissed suggestions are session-only, not persisted — recomputed from
  // scratch on every page load. A dismissed pair coming back after a reload
  // is a reasonable trade for not needing a whole new table just to
  // remember "not a duplicate" clicks.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const byType = useMemo(() => {
    const groups: Record<DimensionType, DimensionRow[]> = { person: [], project: [], meeting: [], topic: [] };
    for (const row of dimensions) groups[row.type].push(row);
    for (const type of TYPE_ORDER) groups[type].sort((a, b) => a.value.localeCompare(b.value));
    return groups;
  }, [dimensions]);

  const duplicateSuggestions = useMemo(() =>
    TYPE_ORDER.flatMap(type => findDuplicateSuggestions(type, byType[type].map(row => row.value)))
      .filter(suggestion => !dismissed.has(pairKey(suggestion.type, suggestion.a, suggestion.b))),
    [byType, dismissed]);

  const startEdit = (row: DimensionRow) => { setEditingId(row.id); setDraft(row.value); setNotice(""); };
  const cancelEdit = () => { setEditingId(null); setDraft(""); };

  // Shared by the inline "Merge / rename" field and the one-click duplicate
  // suggestion buttons below — both just need to say which type, what's
  // going away, and what survives.
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

  const applyRetag = async (row: DimensionRow) => {
    const to = draft.trim();
    if (!to || to === row.value) return;
    await retag(row.type, row.value, to);
    cancelEdit();
  };

  const removeSuggestion = async (row: DimensionRow) => {
    if (!window.confirm(`Remove "${row.value}" from the ${TYPE_LABEL[row.type].toLowerCase()} suggestion list? This only stops it being suggested — it won't change any task that already uses it.`)) return;
    const response = await fetch("/api/dimensions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: row.id }) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error); return; }
    setDimensions(items => items.filter(item => item.id !== row.id));
    setNotice(data.stillUsedByTasks ? `Removed "${row.value}" — but ${data.stillUsedByTasks} task${data.stillUsedByTasks === 1 ? " still uses" : "s still use"} it, so it'll come back unless you rename or merge ${data.stillUsedByTasks === 1 ? "that task" : "those tasks"} too.` : `Removed "${row.value}" from suggestions.`);
  };

  const dismissSuggestion = (type: DimensionType, a: string, b: string) => setDismissed(prev => new Set(prev).add(pairKey(type, a, b)));

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
            <p>Merge or rename duplicate names, projects, meetings, and topics — every task and user scope that references the old value is updated to the new one, so nothing gets lost.</p>
          </div>
        </header>
        {notice && <button className="toast" onClick={() => setNotice("")}>{notice} ×</button>}

        {duplicateSuggestions.length > 0 && (
          <section>
            <div className="section-title"><div><span className="eyebrow">POSSIBLE DUPLICATES</span><h2>Worth a look</h2></div><span>{duplicateSuggestions.length}</span></div>
            <div className="cleanup-panel">
              <p className="hint">Pick which name should be the survivor — every task and user scope pointing at the other one gets switched over automatically.</p>
              <div className="user-list">
                {duplicateSuggestions.map(suggestion => (
                  <article key={pairKey(suggestion.type, suggestion.a, suggestion.b)} className="user-row active">
                    <div className="identity">
                      <b>{suggestion.a} <span style={{ fontWeight: 400, color: "#9299a3" }}>vs</span> {suggestion.b}</b>
                      <small>{TYPE_LABEL[suggestion.type].slice(0, -1)} · {suggestion.reason}</small>
                    </div>
                    <div className="row-actions">
                      <button className="manage" disabled={busy} onClick={() => void retag(suggestion.type, suggestion.a, suggestion.b)}>Keep &quot;{suggestion.b}&quot;</button>
                      <button className="manage" disabled={busy} onClick={() => void retag(suggestion.type, suggestion.b, suggestion.a)}>Keep &quot;{suggestion.a}&quot;</button>
                      <button className="manage" onClick={() => dismissSuggestion(suggestion.type, suggestion.a, suggestion.b)}>Not a duplicate</button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {TYPE_ORDER.map(type => byType[type].length > 0 && (
          <section key={type}>
            <div className="section-title"><div><span className="eyebrow">{TYPE_LABEL[type].toUpperCase()}</span><h2>{TYPE_LABEL[type]}</h2></div><span>{byType[type].length}</span></div>
            <div className="user-list">
              {byType[type].map(row => (
                <article key={row.id} className="user-row active">
                  <div className="identity">
                    <b>{row.value}</b>
                    <small>{row.usageCount} task slot{row.usageCount === 1 ? "" : "s"}{type === "person" ? ` · ${formatActivity(row.lastActivity)}` : ""}</small>
                  </div>
                  {editingId === row.id ? (
                    <div className="row-actions" style={{ flex: 1, gap: 8 }}>
                      <input aria-label={`New name for "${row.value}"`} list={`suggest-${type}`} value={draft} onChange={e => setDraft(e.target.value)} placeholder="New name, or pick an existing one to merge into" style={{ flex: 1, minWidth: 220 }} onKeyDown={e => { if (e.key === "Enter") void applyRetag(row); if (e.key === "Escape") cancelEdit(); }} />
                      <datalist id={`suggest-${type}`}>{byType[type].filter(item => item.id !== row.id).map(item => <option key={item.id} value={item.value} />)}</datalist>
                      <button className="manage" disabled={busy || !draft.trim() || draft.trim() === row.value} onClick={() => void applyRetag(row)}>{busy ? "Saving…" : "Save"}</button>
                      <button className="manage" onClick={cancelEdit}>Cancel</button>
                    </div>
                  ) : (
                    <div className="row-actions">
                      <button className="manage" onClick={() => startEdit(row)}>Merge / rename</button>
                      <button className="manage" onClick={() => void removeSuggestion(row)}>Remove</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
        {dimensions.length === 0 && <p className="hint">Nothing to clean up yet.</p>}
      </section>
    </main>
  );
}
