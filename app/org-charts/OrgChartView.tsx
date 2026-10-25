"use client";
import { useMemo, useRef, useState } from "react";
import type { OrgChart, OrgNode, OrgTaskItem } from "../lib/close-plan-orgchart";
import "./org-charts.css";

// The interactive org chart, same behaviour as the iSEEit chart in Salesforce but read-only: click a card for its details,
// the task icon for the person's open tasks and events, the chevron under a manager to collapse the team, drag the
// background to pan, and the zoom buttons.
export type ChartData = OrgChart & { salesforceBase: string };
type TaskState = { busy?: boolean; items?: OrgTaskItem[]; error?: string };

const EDGE: Record<string, string> = { Champion: "#4e9f3d", Coach: "#f5d000", Enemy: "#e8847c" };
const LI = "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z";
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const dateText = (d: string) => { if (!d) return "No date"; const x = new Date(d + "T00:00:00"); return isNaN(x.getTime()) ? d : x.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };

const Warn = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#b3261e" d="M12 2 1 21h22z" /><path fill="#fff" d="M11 9h2v6h-2zm0 7h2v2h-2z" /></svg>;
const Star = ({ blue }: { blue: boolean }) => <svg viewBox="0 0 24 24" width="18" height="18" aria-label="Power base"><path fill={blue ? "#8fb8e8" : "#f5c400"} d="M12 2l3 6.6 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.2l1.5-7L2 9.4l7-.8z" /></svg>;

export default function OrgChartView({ chartId, chart }: { chartId: string; chart: ChartData }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const wrap = useRef<HTMLDivElement>(null);

  const { byKey, kids } = useMemo(() => {
    const byKey = new Map<string, OrgNode>(), kids = new Map<string | null, OrgNode[]>();
    for (const n of chart.nodes) { byKey.set(n.key, n); kids.set(n.parentKey, [...(kids.get(n.parentKey) || []), n]); }
    return { byKey, kids };
  }, [chart]);
  const below = (n: OrgNode): number => (kids.get(n.key) || []).reduce((sum, k) => sum + 1 + below(k), 0);
  // eslint-disable-next-line @next/next/no-img-element
  const photo = (n: OrgNode) => n.photo ? <img src={`/api/org-charts/${encodeURIComponent(chartId)}/photo/${encodeURIComponent(n.photo)}`} alt="" loading="lazy" onError={e => e.currentTarget.remove()} /> : null;

  function open(key: string) {
    setSelected(key);
    if (!/^003/.test(key) || tasks[key]) return;
    setTasks(t => ({ ...t, [key]: { busy: true } }));
    fetch(`/api/org-charts/${encodeURIComponent(chartId)}/tasks?contact=${encodeURIComponent(key)}`, { credentials: "same-origin" })
      .then(async r => { const res = await r.json().catch(() => ({})); setTasks(t => ({ ...t, [key]: r.ok ? { items: res.items || [] } : { error: res.error || "The tasks could not be read" } })); })
      .catch(() => setTasks(t => ({ ...t, [key]: { error: "Salesforce could not be reached." } })));
  }

  function pan(e: React.MouseEvent) {
    const el = wrap.current;
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest(".oc-card, .oc-chev")) return;
    const x = e.clientX, y = e.clientY, l = el.scrollLeft, t = el.scrollTop;
    el.classList.add("pan");
    const move = (m: MouseEvent) => { el.scrollLeft = l - (m.clientX - x); el.scrollTop = t - (m.clientY - y); };
    const up = () => { el.classList.remove("pan"); document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }

  const card = (n: OrgNode) => (
    <div className={`oc-card${selected === n.key ? " sel" : ""}`} tabIndex={0} role="button" aria-label={`${n.name}, show details`} style={{ borderLeftColor: EDGE[n.type] || "#c4c4c4" }}
      onClick={() => open(n.key)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(n.key); } }}>
      {n.provisional && <span className="oc-tmp">Temp</span>}
      <div className="oc-av">{initials(n.name)}{photo(n)}</div>
      <div className="oc-tx"><div className="oc-nm">{n.name}</div><div className="oc-ds">{n.title}</div><div className="oc-ft"><span className="oc-rl">{n.dealRole}</span></div></div>
      <div className="oc-rp">
        <div className="oc-top">{n.powerBase && <Star blue={/Economic Buyer/.test(n.dealRole)} />}{n.left && <button type="button" className="oc-warn" aria-label="Contact left the organization" onClick={e => e.stopPropagation()}><Warn /><i>Contact left the organization</i></button>}</div>
        {!n.provisional && (
          <div className="oc-bot">
            <button type="button" className="oc-ic" title="Open tasks and events in Salesforce" aria-label="Open tasks and events" onClick={e => { e.stopPropagation(); open(n.key); }}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#44546f" d="M9 2h6v2h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3zm1.5 2v2h3V4zM9 12h6v2H9zm0 4h4v2H9z" /></svg><b>{n.openTasks || 0}</b>
            </button>
            {n.linkedin
              ? <a className="oc-in" href={n.linkedin} target="_blank" rel="noopener noreferrer" title="LinkedIn profile" aria-label="LinkedIn profile" onClick={e => e.stopPropagation()}><svg viewBox="0 0 24 24" width="17" height="17"><path fill="#0a66c2" d={LI} /></svg></a>
              : <span className="oc-in" title="No LinkedIn profile on the contact"><svg viewBox="0 0 24 24" width="17" height="17"><path fill="#d0d4da" d={LI} /></svg></span>}
          </div>
        )}
      </div>
    </div>
  );

  const branch = (n: OrgNode): React.ReactNode => {
    const k = kids.get(n.key) || [], shut = collapsed.has(n.key);
    return (
      <li key={n.key}>
        {card(n)}
        {k.length > 0 && (
          <button type="button" className={`oc-chev${shut ? " shut" : ""}`} aria-expanded={!shut} aria-label={`${shut ? "Show" : "Hide"} the team of ${n.name}`} title={`${shut ? "Show" : "Hide"} ${below(n)} below`}
            onClick={e => { e.stopPropagation(); setCollapsed(s => { const next = new Set(s); if (next.has(n.key)) next.delete(n.key); else next.add(n.key); return next; }); }}>
            {shut ? <b>+{below(n)}</b> : "⌃"}
          </button>
        )}
        {k.length > 0 && !shut && <ul>{k.map(branch)}</ul>}
      </li>
    );
  };

  const sel = selected ? byKey.get(selected) : null;
  const t = sel ? tasks[sel.key] : undefined;
  const parent = sel?.parentKey ? byKey.get(sel.parentKey) : null;
  const team = sel ? (kids.get(sel.key) || []).length : 0;
  const row = (label: string, value: React.ReactNode) => value ? <div className="oc-r"><span>{label}</span><div>{value}</div></div> : null;

  if (!chart.nodes.length) return <p className="oc-hint">This org chart is empty in Salesforce.</p>;
  return (
    <div>
      <div className="oc-bar">
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(z => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(z => Math.min(1.6, Math.round((z + 0.1) * 10) / 10))}>+</button>
        <button type="button" onClick={() => setZoom(1)}>Reset</button>
        {collapsed.size > 0 && <button type="button" onClick={() => setCollapsed(new Set())}>Show all teams</button>}
      </div>
      <div className="oc-main">
        <div className="oc-wrap" ref={wrap} role="presentation" onMouseDown={pan}><ul className="oc-tree" style={{ zoom }}>{chart.roots.map(k => byKey.get(k)).filter((n): n is OrgNode => Boolean(n)).map(branch)}</ul></div>
        {sel && (
          <aside className="oc-panel" aria-label={sel.name}>
            <button type="button" className="oc-x" aria-label="Close details" onClick={() => setSelected(null)}>×</button>
            <div className="oc-ph"><div className="oc-av big">{initials(sel.name)}{photo(sel)}</div><div><h3>{sel.name}</h3><p>{sel.title}</p></div></div>
            {sel.left && <p className="oc-left"><Warn /> Salesforce says this contact left the organization.</p>}
            {row("Type", sel.type)}{row("Deal role", sel.dealRole)}{row("Power base", sel.powerBase ? "Yes" : "")}{row("Reports to", parent?.name)}{row("Direct reports", team ? String(team) : "")}
            {row("Email", sel.email && <a href={`mailto:${sel.email}`}>{sel.email}</a>)}{row("Phone", sel.phone)}{row("Notes", sel.description)}
            <div className="oc-links">
              {chart.salesforceBase && /^003/.test(sel.key) && <a className="oc-btn" href={`${chart.salesforceBase}/lightning/r/Contact/${encodeURIComponent(sel.key)}/view`} target="_blank" rel="noopener noreferrer">Go to contact in Salesforce ↗</a>}
              {sel.linkedin && <a className="oc-btn" href={sel.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn profile ↗</a>}
            </div>
            <h4>Open tasks and events in Salesforce <em>{sel.provisional ? "" : sel.openTasks || 0}</em></h4>
            {sel.provisional ? <p className="oc-hint">A placeholder contact has no tasks in Salesforce.</p>
              : !t || t.busy ? <p className="oc-hint">Reading Salesforce…</p>
              : t.error ? <p className="oc-err">{t.error}</p>
              : !t.items?.length ? <p className="oc-hint">No open tasks or upcoming events with this person.</p>
              : <ul className="oc-tl">{t.items.map(i => <li key={i.id}><b>{i.subject}</b><small>{i.kind} · {dateText(i.when)}{i.status && i.kind === "Task" ? ` · ${i.status}` : ""}{i.owner ? ` · ${i.owner}` : ""}</small></li>)}</ul>}
          </aside>
        )}
      </div>
      <p className="oc-hint">{chart.nodes.length} {chart.nodes.length === 1 ? "person" : "people"}. Click a card for details, drag the background to move around.</p>
      {chart.issues.length > 0 && <details className="oc-hint"><summary>{chart.issues.length} {chart.issues.length === 1 ? "thing" : "things"} to check in Salesforce</summary><ul style={{ paddingLeft: 18 }}>{chart.issues.map((i, k) => <li key={k}>{i.text}</li>)}</ul></details>}
    </div>
  );
}
