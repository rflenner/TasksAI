"use client";

import { useState } from "react";
import type { OrgNode } from "../lib/close-plan-orgchart";
import type { OrgEdit } from "../lib/org-chart-edit";

// LinkedIn enrichment next to the chart: check the people against LinkedIn, and find new people to add. Everything found is a
// suggestion; the chart changes only for what is ticked and applied. Salesforce is written to only when "Also update Salesforce" is ticked.
type Suggestion = { id: string; key: string; name: string; kind: "left" | "back" | "title" | "url"; from: string; to: string; detail: string; linkedin: string };
type Person = { url: string; name: string; headline: string; photo: string; title: string; company: string; inChart: boolean };
type CheckResult = { suggestions: Suggestion[]; checked: number; total: number; capped: boolean; noDomain: boolean; failed: number };

const LABEL: Record<Suggestion["kind"], string> = { left: "Left the company", back: "Still at the company", title: "New title", url: "LinkedIn profile found" };
const SF_CONTACT = /^003[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;

async function call<T>(chartId: string, body: object): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const r = await fetch(`/api/org-charts/${encodeURIComponent(chartId)}/linkedin`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const res = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok) return { ok: false, error: res.error || "LinkedIn could not be reached." };
  return { ok: true, data: res as T };
}

export default function LinkedInPanel({ chartId, nodes, parentKey, send, onClose }: { chartId: string; nodes: OrgNode[]; parentKey: string; send: (edit: OrgEdit) => Promise<boolean>; onClose: () => void }) {
  const [tab, setTab] = useState<"check" | "find">("check");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toSalesforce, setToSalesforce] = useState(false);
  const [q, setQ] = useState({ name: "", position: "", url: "" });
  const [people, setPeople] = useState<Person[] | null>(null);
  const byKey = new Map(nodes.map(n => [n.key, n]));

  async function check() {
    setBusy(true); setMsg(""); setResult(null);
    const res = await call<CheckResult>(chartId, { action: "check" });
    setBusy(false);
    if (!res.ok) { setMsg(res.error); return; }
    setResult(res.data); setPicked(new Set(res.data.suggestions.map(s => s.id)));
  }
  async function apply() {
    if (!result) return;
    const chosen = result.suggestions.filter(s => picked.has(s.id));
    const perPerson = new Map<string, { left?: boolean; title?: string; linkedin?: string }>();
    for (const s of chosen) {
      const c = perPerson.get(s.key) || {};
      if (s.kind === "left") c.left = true; else if (s.kind === "back") c.left = false; else if (s.kind === "title") c.title = s.to; else c.linkedin = s.to;
      perPerson.set(s.key, c);
    }
    setBusy(true); setMsg("");
    let done = 0; const problems: string[] = [];
    for (const [key, change] of perPerson) {
      if (!(await send({ op: "update", key, ...change }))) { problems.push(byKey.get(key)?.name || key); continue; }
      done++;
      if (toSalesforce && SF_CONTACT.test(key)) {
        const w = await call(chartId, { action: "writeback", key, ...change, linkedin: change.linkedin || undefined });
        if (!w.ok) problems.push(`${byKey.get(key)?.name || key} (Salesforce: ${w.error})`);
      }
    }
    setBusy(false);
    setResult(r => r && { ...r, suggestions: r.suggestions.filter(s => !picked.has(s.id) || problems.some(p => p.startsWith(byKey.get(s.key)?.name || "\0"))) });
    setPicked(new Set());
    setMsg(`${done} ${done === 1 ? "person" : "people"} updated${toSalesforce ? " in the chart and Salesforce" : ""}.${problems.length ? ` Not saved: ${problems.join(", ")}.` : ""}`);
  }
  async function search() {
    setBusy(true); setMsg(""); setPeople(null);
    const res = await call<{ people: Person[] }>(chartId, { action: "search", ...q });
    setBusy(false);
    if (!res.ok) { setMsg(res.error); return; }
    setPeople(res.data.people); if (!res.data.people.length) setMsg("Nobody found. Try fewer words, or paste the LinkedIn address.");
  }
  async function add(p: Person) {
    setBusy(true);
    const ok = await send({ op: "add", name: p.name, title: p.title || p.headline, parentKey: parentKey || null, linkedin: p.url });
    setBusy(false);
    if (ok) setPeople(list => list && list.map(x => x.url === p.url ? { ...x, inChart: true } : x));
  }
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const noSf = (result?.suggestions || []).filter(s => picked.has(s.id)).every(s => !SF_CONTACT.test(s.key));

  return (
    <div className="oc-pop wide" role="dialog" aria-label="LinkedIn">
      <div className="oc-row">
        <button type="button" className={tab === "check" ? "on" : ""} onClick={() => { setTab("check"); setMsg(""); }}>Check people</button>
        <button type="button" className={tab === "find" ? "on" : ""} onClick={() => { setTab("find"); setMsg(""); }}>Find people</button>
      </div>
      {tab === "check" && <>
        <p>Compares the people in this chart with their LinkedIn profile: who left, new titles and missing profile links. Uses Sales AI first, then Enrich Layer (one credit per profile, up to 40 people).</p>
        {!result && <div className="oc-row"><button type="button" disabled={busy} onClick={check}>{busy ? "Checking…" : "Check against LinkedIn"}</button></div>}
        {result && <>
          <p><b>{result.checked}</b> of {result.total} people checked{result.capped ? " (the first 40)" : ""}{result.failed ? `, ${result.failed} could not be read` : ""}.{result.noDomain && " The account has no website in Salesforce, so missing profile links were only looked up through Sales AI."}</p>
          {!result.suggestions.length && <p>Nothing to change.</p>}
          <ul className="oc-li-list">
            {result.suggestions.map(s => (
              <li key={s.id}>
                <label className="oc-li-row"><input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span><b>{s.name}</b>: {LABEL[s.kind]}{s.kind === "title" ? <> — {s.from ? <>“{s.from}” → </> : null}“{s.to}”</> : null}{s.kind === "url" ? <> — <a href={s.to} target="_blank" rel="noopener noreferrer">open</a></> : null}<br /><small>{s.detail}{s.kind !== "url" && s.linkedin ? <> <a href={s.linkedin} target="_blank" rel="noopener noreferrer">Profile</a></> : null}</small></span>
                </label>
              </li>
            ))}
          </ul>
          {result.suggestions.length > 0 && <>
            <label className="oc-li-sf"><input type="checkbox" checked={toSalesforce} onChange={e => setToSalesforce(e.target.checked)} /> Also update the contact in Salesforce{toSalesforce && !noSf ? " (changes the live record)" : ""}</label>
            <div className="oc-row"><button type="button" className="on" disabled={busy || !picked.size} onClick={apply}>{busy ? "Applying…" : `Apply ${picked.size}`}</button><button type="button" disabled={busy} onClick={check}>Check again</button></div>
          </>}
        </>}
      </>}
      {tab === "find" && <>
        <p>Find someone at {" "}this account on LinkedIn and add them to the chart{parentKey && byKey.get(parentKey) ? <> under {byKey.get(parentKey)!.name}</> : " at the top level"}.</p>
        <form className="oc-li-form" onSubmit={e => { e.preventDefault(); void search(); }}>
          <label>Name<input value={q.name} onChange={e => setQ({ ...q, name: e.target.value })} placeholder="Jane Doe" /></label>
          <label>Position<input value={q.position} onChange={e => setQ({ ...q, position: e.target.value })} placeholder="VP Clinical Operations" /></label>
          <label>or LinkedIn address<input value={q.url} onChange={e => setQ({ ...q, url: e.target.value })} placeholder="linkedin.com/in/…" /></label>
          <div className="oc-row"><button type="submit" className="on" disabled={busy || (!q.name.trim() && !q.position.trim() && !q.url.trim())}>{busy ? "Searching…" : "Search"}</button></div>
        </form>
        {people && <ul className="oc-li-list">
          {people.map(p => (
            <li key={p.url} className="oc-li-person">
              <span><b>{p.name}</b><br /><small>{p.title || p.headline}{p.company ? ` · ${p.company}` : ""} · <a href={p.url} target="_blank" rel="noopener noreferrer">Profile</a></small></span>
              <button type="button" disabled={busy || p.inChart} onClick={() => add(p)}>{p.inChart ? "In chart" : "Add"}</button>
            </li>
          ))}
        </ul>}
      </>}
      {msg && <p role="status" className="oc-li-msg">{msg}</p>}
      <div className="oc-row"><button type="button" onClick={onClose}>Close</button></div>
    </div>
  );
}
