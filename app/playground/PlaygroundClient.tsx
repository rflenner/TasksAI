"use client";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { isOpportunityId, type OpportunityHit } from "../lib/salesforce-opportunity-search";
import "../users/users.css";
import "./playground.css";

type Checkpoint = { id: string; title: string; status: boolean; phaseCheckpointStatus: string | null; deadline: string | null; owner: string | null; order: number | null; required: string | null; description: string };
type Phase = { id: string; title: string; order: number | null; startDate: string | null; endDate: string | null; checkpoints: Checkpoint[] };
type Loaded = { opportunity: { id: string; name: string }; phases: Phase[] };
type SendResult = { id: string; success: boolean; error?: string };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const formatDate = (value: string | null) => (value ? dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : null);

function statusLabel(checkpoint: Checkpoint) {
  return checkpoint.phaseCheckpointStatus || (checkpoint.status ? "Completed" : "Open");
}

// Playground: look up a Salesforce opportunity by id, list its close-plan
// checkpoints phase by phase, edit any checkpoint's description, and send
// the edited ones back to Salesforce in one go
// (app/api/playground/checkpoints/route.ts). Uses the workspace's
// Salesforce connection from /integrations.
export default function PlaygroundClient({ initialOpportunityId = "" }: { initialOpportunityId?: string }) {
  // One box: type a name or account to search Salesforce, or paste an opportunity ID.
  const [opportunityId, setOpportunityId] = useState(initialOpportunityId);
  // The last finished search; what's shown is derived from it and the box (only the delayed search sets it).
  const [search, setSearch] = useState<{ q: string; hits: OpportunityHit[]; error: string }>({ q: "", hits: [], error: "" });
  const typed = opportunityId.trim();
  const searchActive = typed.length >= 2 && !isOpportunityId(typed);
  const searchSettled = search.q === typed;
  const searching = searchActive && !searchSettled;
  const hits = searchActive && searchSettled ? search.hits : [];
  const searchError = searchActive && searchSettled ? search.error : "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notConnected, setNotConnected] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // What Salesforce last had for each checkpoint vs. what's in the box now.
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Record<string, SendResult>>({});
  const [sendMessage, setSendMessage] = useState("");

  const edited = Object.keys(drafts).filter(id => drafts[id] !== saved[id]);

  // Search as you type (after a short pause), unless what's in the box is already an ID.
  useEffect(() => {
    if (!searchActive) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/playground/opportunities?q=${encodeURIComponent(typed)}`).catch(() => null);
      const data = (await response?.json().catch(() => ({}))) as { opportunities?: OpportunityHit[]; error?: string } | undefined;
      if (cancelled) return;
      if (!response?.ok) { setNotConnected(response?.status === 409); setSearch({ q: typed, hits: [], error: data?.error || "Search failed" }); return; }
      setSearch({ q: typed, hits: data?.opportunities || [], error: "" });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [typed, searchActive]);

  const fetchCheckpoints = async (event: FormEvent | null, picked?: string) => {
    event?.preventDefault();
    const id = (picked || opportunityId).trim();
    if (!id || loading) return;
    if (!isOpportunityId(id)) { setError("Pick an opportunity from the list, or paste its 15 or 18 character ID."); return; }
    setSearch({ q: "", hits: [], error: "" });
    if (edited.length && !window.confirm(`You have ${edited.length} unsent description${edited.length === 1 ? "" : "s"}. Discard them and fetch again?`)) return;
    setLoading(true); setError(""); setNotConnected(false); setResults({}); setSendMessage("");
    const response = await fetch(`/api/playground/checkpoints?opportunityId=${encodeURIComponent(id)}`);
    const data = await response.json().catch(() => ({})) as Loaded & { error?: string };
    setLoading(false);
    if (!response.ok) {
      setLoaded(null);
      setNotConnected(response.status === 409);
      setError(data.error || "Couldn't fetch checkpoints");
      return;
    }
    const descriptions = Object.fromEntries(data.phases.flatMap(phase => phase.checkpoints.map(checkpoint => [checkpoint.id, checkpoint.description])));
    setLoaded(data); setSaved(descriptions); setDrafts(descriptions);
  };

  // Opened from a close plan (…/playground?opportunityId=…): fetch it straight away.
  const autoFetched = useRef(false);
  useEffect(() => {
    if (autoFetched.current || !isOpportunityId(initialOpportunityId)) return;
    autoFetched.current = true;
    void fetchCheckpoints(null, initialOpportunityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    if (!loaded || !edited.length || sending) return;
    setSending(true); setSendMessage(""); setResults({});
    const updates = edited.map(id => ({ id, description: drafts[id] }));
    const response = await fetch("/api/playground/checkpoints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId: loaded.opportunity.id, updates }) });
    const data = await response.json().catch(() => ({})) as { results?: SendResult[]; error?: string };
    setSending(false);
    if (!response.ok || !data.results) { setNotConnected(response.status === 409); setSendMessage(data.error || "Couldn't send to Salesforce"); return; }
    const byId = Object.fromEntries(data.results.map(result => [result.id, result]));
    setResults(byId);
    // Whatever Salesforce accepted is now the saved value; failures stay edited.
    setSaved(prev => ({ ...prev, ...Object.fromEntries(updates.filter(update => byId[update.id]?.success).map(update => [update.id, update.description])) }));
    const ok = data.results.filter(result => result.success).length, failed = data.results.length - ok;
    setSendMessage(failed ? `${ok} sent, ${failed} failed — see the checkpoints marked below.` : `${ok} checkpoint description${ok === 1 ? "" : "s"} sent to Salesforce.`);
  };

  const checkpointCount = loaded?.phases.reduce((sum, phase) => sum + phase.checkpoints.length, 0) ?? 0;

  return (
    <main className="users-shell">
      <aside className="users-side">
        <Link className="users-logo" href="/">Task <b>AI</b></Link>
        <nav>
          <Link href="/">← Action items</Link>
          <Link href="/users">Users & access</Link>
          <Link href="/data-hygiene">Data Hygiene</Link>
          <Link href="/integrations">Integrations</Link>
          <Link className="active" href="/playground">Playground</Link>
          <Link href="/email-preview">Email notifications</Link>
        </nav>
      </aside>
      <section className="users-work">
        <header>
          <div>
            <span className="eyebrow">COMPANY SETTINGS</span>
            <h1>Playground</h1>
            <p>Fetch an opportunity&apos;s close-plan checkpoints from Salesforce, add descriptions, and send them back.</p>
          </div>
        </header>

        <form className="pg-lookup" onSubmit={e => void fetchCheckpoints(e)}>
          <label className="pg-search">
            <span>Opportunity</span>
            <input value={opportunityId} onChange={e => setOpportunityId(e.target.value)} placeholder="Search by opportunity or account name, or paste an ID" spellCheck={false} autoComplete="off" aria-label="Opportunity: search by name or paste an ID" />
            {searchActive && (
              <div className="pg-hits" role="listbox" aria-label="Matching opportunities">
                {searching && <div className="pg-hit-note">Searching Salesforce…</div>}
                {!searching && searchError && <div className="pg-hit-note">{searchError}</div>}
                {!searching && !searchError && !hits.length && <div className="pg-hit-note">No opportunity matches “{typed}”.</div>}
                {hits.map(hit => (
                  <button type="button" role="option" aria-selected="false" key={hit.id} className="pg-hit" onClick={() => { setOpportunityId(hit.id); void fetchCheckpoints(null, hit.id); }}>
                    <b>{hit.name}</b>
                    <small>{[hit.account, hit.stage, hit.closeDate && formatDate(hit.closeDate), hit.owner].filter(Boolean).join(" · ")}</small>
                  </button>
                ))}
              </div>
            )}
          </label>
          <button className="manage" type="submit" disabled={loading || !isOpportunityId(opportunityId.trim())}>{loading ? "Fetching…" : "Fetch checkpoints"}</button>
        </form>
        {error && <div className="pg-error">{error}{notConnected && <> <Link href="/integrations">Go to Integrations →</Link></>}</div>}

        {loaded && (
          <section className="pg-result">
            <div className="pg-opportunity">
              <div>
                <b>{loaded.opportunity.name}</b>
                <small>{loaded.opportunity.id} · {loaded.phases.length} phase{loaded.phases.length === 1 ? "" : "s"} · {checkpointCount} checkpoint{checkpointCount === 1 ? "" : "s"}</small>
              </div>
            </div>

            {checkpointCount === 0 && <p className="hint">This opportunity has no close-plan checkpoints in Salesforce.</p>}

            {loaded.phases.map(phase => (
              <div className="pg-phase" key={phase.id}>
                <div className="pg-phase-head">
                  <h2>{phase.title}</h2>
                  {(phase.startDate || phase.endDate) && <small>{[formatDate(phase.startDate), formatDate(phase.endDate)].filter(Boolean).join(" – ")}</small>}
                </div>
                {phase.checkpoints.length === 0 && <p className="hint">No checkpoints in this phase.</p>}
                {phase.checkpoints.map(checkpoint => {
                  const isEdited = drafts[checkpoint.id] !== saved[checkpoint.id];
                  const result = results[checkpoint.id];
                  return (
                    <article className={`pg-checkpoint${isEdited ? " edited" : ""}`} key={checkpoint.id}>
                      <div className="pg-checkpoint-head">
                        <b>{checkpoint.title}</b>
                        <span className={`pg-status${checkpoint.status ? " done" : ""}`}>{statusLabel(checkpoint)}</span>
                      </div>
                      <div className="pg-meta">
                        {checkpoint.deadline && <span>Due {formatDate(checkpoint.deadline)}</span>}
                        {checkpoint.owner && <span>Owner: {checkpoint.owner}</span>}
                        {checkpoint.required && <span>{checkpoint.required}</span>}
                        <span className="pg-id">{checkpoint.id}</span>
                      </div>
                      <label className="pg-description">
                        <span>Description</span>
                        <textarea rows={3} value={drafts[checkpoint.id] ?? ""} placeholder="Add a description for this checkpoint" onChange={e => { const value = e.target.value; setDrafts(prev => ({ ...prev, [checkpoint.id]: value })); }} />
                      </label>
                      {isEdited && !result && <small className="pg-flag">Edited — not sent yet</small>}
                      {result?.success && !isEdited && <small className="pg-flag sent">✓ Sent to Salesforce</small>}
                      {result && !result.success && <small className="pg-flag failed">✕ {result.error}</small>}
                    </article>
                  );
                })}
              </div>
            ))}

            {checkpointCount > 0 && (
              <div className="pg-send">
                <span>{sendMessage || (edited.length ? `${edited.length} checkpoint${edited.length === 1 ? "" : "s"} edited` : "Edit a description to send it to Salesforce")}</span>
                <button type="button" className="pg-send-button" disabled={!edited.length || sending} onClick={() => void send()}>{sending ? "Sending…" : "Send to Salesforce"}</button>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
