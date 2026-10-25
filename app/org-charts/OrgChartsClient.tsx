"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import OrgChartView, { type ChartData } from "./OrgChartView";

type Kind = "account" | "opportunity";
export type ChartRow = { id: string; kind: Kind; sfdcId: string; name: string; accountName: string; people: number; importedAt: string; importedBy: string; editedAt: string | null };
type Hit = { id: string; name: string; accountId: string; account: string; detail: string; owner: string };
type Opened = { id: string; kind: Kind; name: string; accountName: string; importedAt: string; edited: boolean; chart: ChartData };

const btn = "border border-[#c9d3e0] rounded-lg px-3 py-1.5 text-sm text-[#2b3445] bg-white hover:bg-[#f4f7fb] disabled:opacity-40";
const primary = "rounded-lg px-4 py-1.5 text-sm font-semibold text-white bg-[#173f76] hover:bg-[#102f59] disabled:opacity-40";
const KIND_LABEL: Record<Kind, string> = { account: "Account", opportunity: "Opportunity" };
// Dates are shown in the visitor's own time zone and language, so they are left out of the server-rendered page.
const useClient = () => useSyncExternalStore(() => () => {}, () => true, () => false);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function OrgChartsClient({ initialCharts }: { initialCharts: ChartRow[] }) {
  const [charts, setCharts] = useState(initialCharts);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [loading, setLoading] = useState("");
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<ChartRow | null>(null);
  const [notice, setNotice] = useState("");
  const client = useClient();

  async function refresh() {
    const r = await fetch("/api/org-charts", { credentials: "same-origin" });
    if (r.ok) setCharts((await r.json()).charts);
  }
  async function open(row: ChartRow) {
    setLoading(row.id); setNotice("");
    const r = await fetch(`/api/org-charts/${encodeURIComponent(row.id)}`, { credentials: "same-origin" });
    const res = await r.json().catch(() => ({}));
    setLoading("");
    if (!r.ok) { setNotice(res.error || "The org chart could not be opened"); return; }
    setOpened(res);
  }
  // Temporary: copy the chart from Salesforce again (replaces the saved copy and throws away the edits made to it).
  const [refreshing, setRefreshing] = useState(false);
  const [askRefresh, setAskRefresh] = useState(false);
  async function pull(row: ChartRow) {
    setAskRefresh(false); setRefreshing(true); setNotice("");
    const r = await fetch("/api/org-charts", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ kind: row.kind, sfdcId: row.sfdcId }] }) }).catch(() => null);
    const res = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setRefreshing(false); setNotice(res.error || res.results?.[0]?.error || "Salesforce could not be reached"); return; }
    await refresh(); await open(row); setRefreshing(false);
    setNotice(`Copied “${row.name}” from Salesforce again.`);
  }
  async function remove(row: ChartRow) {
    const r = await fetch(`/api/org-charts/${encodeURIComponent(row.id)}`, { method: "DELETE", credentials: "same-origin" });
    const res = await r.json().catch(() => ({}));
    setDeleting(null);
    if (!r.ok) { setNotice(res.error || "The org chart could not be deleted"); return; }
    if (opened?.id === row.id) setOpened(null);
    setNotice(`Deleted “${row.name}”. Nothing was changed in Salesforce.`);
    await refresh();
  }

  if (opened) {
    const row = charts.find(c => c.id === opened.id);
    return (
      <div>
        <button type="button" className="text-sm text-[#697181] mt-4" onClick={() => setOpened(null)}>← All org charts</button>
        <div className="flex items-start justify-between gap-4 mt-2 mb-4">
          <div>
            <div className="text-[11px] font-extrabold tracking-widest text-[#173f76]">{KIND_LABEL[opened.kind].toUpperCase()} ORG CHART</div>
            <h1 className="text-2xl font-bold text-[#102f59] mt-1">{opened.name}</h1>
            <p className="text-sm text-[#697181]">{opened.kind === "opportunity" && opened.accountName ? `${opened.accountName} · ` : ""}Copied from Salesforce {when(opened.importedAt)}. Changes you make here stay in Task AI and are never sent to Salesforce.</p>
          </div>
          {row && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {askRefresh
                ? <span className="text-sm text-[#2b3445]">{row.editedAt ? "This replaces the copy and throws away your edits. " : "This replaces the copy. "}<button type="button" className={btn} onClick={() => void pull(row)}>Yes, copy again</button> <button type="button" className={btn} onClick={() => setAskRefresh(false)}>No</button></span>
                : <button type="button" className={btn} disabled={refreshing} onClick={() => setAskRefresh(true)} title="Temporary: copy this chart from Salesforce again">{refreshing ? "Copying…" : "Pull from Salesforce"}</button>}
              <button type="button" className={btn} onClick={() => setDeleting(row)}>Delete</button>
            </div>
          )}
        </div>
        {notice && <p className="text-sm text-[#2b3445] bg-[#eef2f8] rounded-lg px-4 py-2 mb-3" role="status">{notice}</p>}
        <OrgChartView key={`${opened.id}-${opened.importedAt}`} chartId={opened.id} chart={opened.chart} edited={opened.edited} title={opened.name} subtitle={[opened.kind === "opportunity" ? opened.accountName : "", `${KIND_LABEL[opened.kind]} org chart`, `copied from Salesforce ${when(opened.importedAt)}`].filter(Boolean).join(" · ")} onChanged={(people, edited) => setCharts(list => list.map(c => c.id === opened.id ? { ...c, people, editedAt: edited ? new Date().toISOString() : null } : c))} />
        {deleting && <DeleteDialog row={deleting} onCancel={() => setDeleting(null)} onConfirm={() => void remove(deleting)} />}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mt-4 mb-6">
        <div>
          <div className="text-[11px] font-extrabold tracking-widest text-[#173f76]">WORKSPACE</div>
          <h1 className="text-2xl font-bold text-[#102f59] mt-1">Org charts</h1>
          <p className="text-[#697181] max-w-2xl">The org charts you copied from Salesforce, for accounts and for opportunities. Open one to look around, or delete the copy. Deleting never changes anything in Salesforce.</p>
        </div>
        <button type="button" className={primary} onClick={() => { setNotice(""); setImporting(true); }}>Import org chart</button>
      </div>
      {notice && <p className="text-sm text-[#2b3445] bg-[#eef2f8] rounded-lg px-4 py-2 mb-4" role="status">{notice}</p>}
      {charts.length === 0 ? (
        <div className="border border-dashed border-[#c9d3e0] rounded-xl p-10 text-center bg-white">
          <h2 className="text-lg font-bold text-[#102f59]">No org charts yet</h2>
          <p className="text-[#697181] mt-1 mb-4">Import an account&apos;s or an opportunity&apos;s org chart from Salesforce.</p>
          <button type="button" className={primary} onClick={() => setImporting(true)}>Import org chart</button>
        </div>
      ) : (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
          {charts.map(c => (
            <li key={c.id} className="border border-[#e3e8ee] bg-white rounded-xl p-5 flex flex-col gap-3">
              <div>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${c.kind === "account" ? "bg-[#e8f0fb] text-[#173f76]" : "bg-[#eaf5ec] text-[#2a6a33]"}`}>{KIND_LABEL[c.kind]}</span>
                <h2 className="text-base font-bold text-[#102f59] mt-2 break-words">{c.name}</h2>
                {c.kind === "opportunity" && c.accountName && <p className="text-sm text-[#697181]">{c.accountName}</p>}
              </div>
              <p className="text-sm text-[#697181]">{c.people} {c.people === 1 ? "person" : "people"} · imported {client ? when(c.importedAt) : ""}{c.importedBy ? ` by ${c.importedBy}` : ""}</p>
              <div className="flex gap-2 mt-auto">
                <button type="button" className={primary} disabled={loading === c.id} onClick={() => void open(c)}>{loading === c.id ? "Opening…" : "Open"}</button>
                <button type="button" className={btn} onClick={() => setDeleting(c)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {importing && <ImportDialog existing={charts} onClose={() => setImporting(false)} onDone={async msg => { setImporting(false); setNotice(msg); await refresh(); }} />}
      {deleting && <DeleteDialog row={deleting} onCancel={() => setDeleting(null)} onConfirm={() => void remove(deleting)} />}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" role="presentation" onMouseDown={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-auto p-6" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between"><h2 className="text-lg font-bold text-[#102f59]">{title}</h2><button type="button" className="text-2xl leading-none text-[#697181]" aria-label="Close" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

function DeleteDialog({ row, onCancel, onConfirm }: { row: ChartRow; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal title="Delete this org chart?" onClose={onCancel}>
      <p className="text-sm text-[#2b3445] mt-3"><b>{row.name}</b> ({KIND_LABEL[row.kind].toLowerCase()}, {row.people} {row.people === 1 ? "person" : "people"}) is removed from Task AI. Nothing is changed in Salesforce, and you can import it again any time.</p>
      <div className="flex justify-end gap-2 mt-6"><button type="button" className={btn} onClick={onCancel}>Cancel</button><button type="button" className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white bg-[#b3261e] hover:bg-[#8f1e18]" onClick={onConfirm}>Delete org chart</button></div>
    </Modal>
  );
}

function ImportDialog({ existing, onClose, onDone }: { existing: ChartRow[]; onClose: () => void; onDone: (message: string) => void | Promise<void> }) {
  const [kind, setKind] = useState<Kind>("opportunity");
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Hit | null>(null);
  const [wantOpportunity, setWantOpportunity] = useState(true);
  const [wantAccount, setWantAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  function search(value: string, k: Kind) {
    setText(value); setPicked(null); setError("");
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) { setHits(null); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/org-charts/search?kind=${k}&q=${encodeURIComponent(value)}`, { credentials: "same-origin" });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) { setError(res.error || "Salesforce search failed"); setHits(null); return; }
        setHits(res.hits);
      } catch { setError("Salesforce could not be reached."); setHits(null); }
    }, 350);
  }
  function switchKind(k: Kind) { setKind(k); setPicked(null); setHits(null); setText(""); setError(""); setWantOpportunity(true); setWantAccount(false); }

  const have = (k: Kind, id: string) => existing.find(c => c.kind === k && c.sfdcId === id);
  const items = !picked ? [] : kind === "account" ? [{ kind: "account" as const, sfdcId: picked.id }] : [
    ...(wantOpportunity ? [{ kind: "opportunity" as const, sfdcId: picked.id }] : []),
    ...(wantAccount && picked.accountId ? [{ kind: "account" as const, sfdcId: picked.accountId }] : []),
  ];

  async function run() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/org-charts", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok && !res.results) { setError(res.error || "The import failed"); setBusy(false); return; }
      const results: Array<{ ok: boolean; kind: string; name?: string; people?: number; error?: string }> = res.results || [];
      const okRows = results.filter(x => x.ok), bad = results.filter(x => !x.ok);
      if (bad.length) { setError(bad.map(b => `${KIND_LABEL[b.kind as Kind]}: ${b.error || "failed"}`).join(" · ")); }
      if (okRows.length && !bad.length) await onDone(`Imported ${okRows.map(x => `“${x.name}” (${x.people} ${x.people === 1 ? "person" : "people"})`).join(" and ")}.`);
      else if (okRows.length) await onDone(`Imported ${okRows.map(x => `“${x.name}”`).join(" and ")}, but ${bad.length} failed: ${bad.map(b => b.error).join(", ")}.`);
      else setBusy(false);
    } catch { setError("The import failed. Check your connection."); setBusy(false); }
  }

  return (
    <Modal title="Import org chart from Salesforce" onClose={onClose}>
      <p className="text-sm text-[#697181] mt-1">Pick an account, an opportunity, or both. A chart you imported before is replaced with the current one from Salesforce.</p>
      <div className="flex gap-2 mt-4" role="tablist" aria-label="Where to import from">
        {(["opportunity", "account"] as const).map(k => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={`${btn} ${kind === k ? "!bg-[#173f76] !text-white" : ""}`} onClick={() => switchKind(k)}>{k === "opportunity" ? "Opportunity" : "Account"}</button>
        ))}
      </div>
      <input className="w-full border border-[#c9d3e0] rounded-lg px-3 py-2 text-sm mt-3" placeholder={kind === "account" ? "Account name" : "Opportunity or account name"} ref={input} value={text} onChange={e => search(e.target.value, kind)} />
      {hits && !picked && (hits.length === 0 ? <p className="text-sm text-[#697181] mt-2">Nothing found.</p> : (
        <ul className="mt-2 border border-[#e3e8ee] rounded-lg divide-y divide-[#eef1f5] max-h-60 overflow-auto">
          {hits.map(h => (
            <li key={h.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-[#f4f7fb]" onClick={() => { setPicked(h); setWantOpportunity(true); setWantAccount(false); }}>
              <span className="block text-sm font-semibold text-[#102f59]">{h.name}</span>
              <span className="block text-xs text-[#697181]">{[kind === "opportunity" ? h.account : "", h.detail, h.owner].filter(Boolean).join(" · ")}</span>
            </button></li>
          ))}
        </ul>
      ))}
      {picked && (
        <div className="mt-3 border border-[#e3e8ee] rounded-lg p-3">
          <div className="flex items-start justify-between gap-2"><div><div className="text-sm font-semibold text-[#102f59]">{picked.name}</div><div className="text-xs text-[#697181]">{[kind === "opportunity" ? picked.account : "", picked.detail].filter(Boolean).join(" · ")}</div></div><button type="button" className="text-sm text-[#173f76]" onClick={() => setPicked(null)}>Change</button></div>
          {kind === "opportunity" ? (
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={wantOpportunity} onChange={e => setWantOpportunity(e.target.checked)} /><span>Opportunity org chart{have("opportunity", picked.id) ? <em className="not-italic text-[#697181]"> — replaces the copy from {when(have("opportunity", picked.id)!.importedAt)}{have("opportunity", picked.id)!.editedAt ? " and discards your edits" : ""}</em> : ""}</span></label>
              <label className={`flex items-start gap-2 ${picked.accountId ? "" : "opacity-50"}`}><input type="checkbox" className="mt-1" disabled={!picked.accountId} checked={wantAccount} onChange={e => setWantAccount(e.target.checked)} /><span>Account org chart{picked.account ? ` of ${picked.account}` : ""}{picked.accountId && have("account", picked.accountId) ? <em className="not-italic text-[#697181]"> — replaces the copy from {when(have("account", picked.accountId)!.importedAt)}{have("account", picked.accountId)!.editedAt ? " and discards your edits" : ""}</em> : ""}</span></label>
            </div>
          ) : have("account", picked.id) ? <p className="text-xs text-[#697181] mt-2">Replaces the copy from {when(have("account", picked.id)!.importedAt)}{have("account", picked.id)!.editedAt ? " and discards your edits" : ""}.</p> : null}
        </div>
      )}
      {error && <p className="text-sm text-[#b3261e] mt-3" role="alert">{error}</p>}
      <div className="flex justify-end gap-2 mt-6">
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!items.length || busy} onClick={() => void run()}>{busy ? "Importing…" : items.length > 1 ? "Import both" : "Import"}</button>
      </div>
    </Modal>
  );
}
