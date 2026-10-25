"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrgChart, OrgNode, OrgTaskItem } from "../lib/close-plan-orgchart";
import type { DropPosition, OrgEdit } from "../lib/org-chart-edit";
import type { InfluenceEdit, InfluenceTone, OrgInfluence } from "../lib/org-chart-influence";
import { planTeam, type TeamPlan } from "../lib/org-chart-layout";
import "./org-charts.css";

// The interactive org chart, same behaviour as the iSEEit chart in Salesforce: click a card for its details, the task icon for
// the person's open tasks and events, the chevron under a manager to collapse the team, drag the background to pan, and the
// zoom buttons. "Edit chart" lets you drag a card onto a new manager, change type, role and notes, add a placeholder person and
// remove someone. Edits are saved on the copy in Task AI only; nothing is written to Salesforce.
export type ChartData = OrgChart & { salesforceBase: string };
type TaskState = { busy?: boolean; items?: OrgTaskItem[]; error?: string };

type Zone = Exclude<DropPosition, "root">;
type Pending = { key: string; targetKey: string | null; position: DropPosition };
// While a card is dragged, the card it is held over (the target) shows four drop areas just outside it, so they stay visible next
// to the dragged card: above (the person becomes its manager), below (reports to it), left and right (a peer beside it). The target
// is the card the dragged card overlaps most, and the side the dragged card sits towards picks the area; centred means below.
const ROOT = "__root"; // the "make top level" bar shown while dragging someone who has a manager
type Pad = { spot: "top" | "bottom" | "left" | "right"; zone: Zone; label: string };
const PADS: Pad[] = [{ spot: "top", zone: "top", label: "▲ Manager" }, { spot: "bottom", zone: "bottom", label: "▼ Reports to" }, { spot: "left", zone: "left", label: "◀ Peer" }, { spot: "right", zone: "right", label: "Peer ▶" }];
// In a ladder the people are stacked, so above and below mean before and after: the manager and reports-to areas move to the sides.
const LADDER_PADS: Pad[] = [{ spot: "top", zone: "left", label: "▲ Before" }, { spot: "bottom", zone: "right", label: "▼ After" }, { spot: "left", zone: "top", label: "◀ Manager" }, { spot: "right", zone: "bottom", label: "Reports to ▶" }];
// Mindset of a contact (the "type" in Salesforce): colours the bar on the left of the tile. Nothing set counts as Neutral (grey).
const MINDSETS = ["Champion", "Coach", "Neutral", "Enemy"];
const EDGE: Record<string, string> = { Champion: "#3f9d3a", Coach: "#f2c500", Neutral: "#c4c4c4", Enemy: "#e03a3a" };
const mindset = (n: { type: string }) => n.type || "Neutral";
const edge = (n: { type: string }) => EDGE[mindset(n)] || EDGE.Neutral;
const ACTIVITY_NOTE = "How well this person is covered, from the meetings and action items with them. Not matched yet: nothing is counted so far.";
// Influence lines: a dotted arrow from the influencer to the influenced person, bent as an arc that steers clear of the other
// cards where it can. Grey by default; "Who influences who" shows them in the colour of the kind of influence (red negative,
// blue neutral, green positive). Thickness shows the strength. The line starts with a star (yellow; blue when the influencer
// is the Economic Buyer, like the star on the tile). Drawn over the chart from the positions of the cards, so it follows
// collapsing, zoom, ladders and the PDF sheet.
type Seg = { id: string; x1: number; y1: number; cx: number; cy: number; x2: number; y2: number; strength: number; tone: InfluenceTone; blue: boolean; from: string; to: string; note: string };
const GREY = "#9aa3af", TONE: Record<InfluenceTone, string> = { negative: "#d64545", neutral: "#2f6fb5", positive: "#3f9d3a" };
const TONE_LABEL: Record<InfluenceTone, string> = { negative: "Negative", neutral: "Neutral", positive: "Positive" };
const STAR = "M12 2l3 6.6 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.2l1.5-7L2 9.4l7-.8z";
const lineWidth = (s: number) => s === 3 ? 3 : s === 2 ? 2 : 1.4;
type Box = { key: string; l: number; t: number; r: number; b: number; cx: number; cy: number; w: number; h: number };
const quad = (p0: { x: number; y: number }, c: { x: number; y: number }, p1: { x: number; y: number }, t: number) => ({ x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x, y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y });
const toward = (a: Box, to: { x: number; y: number }, pad: number) => { const dx = to.x - a.cx, dy = to.y - a.cy, k = Math.min((a.w / 2 + pad) / Math.abs(dx || 1e-9), (a.h / 2 + pad) / Math.abs(dy || 1e-9)); return { x: a.cx + dx * Math.min(k, 1), y: a.cy + dy * Math.min(k, 1) }; };
function lineSegs(canvas: HTMLElement, list: OrgInfluence[], byKey: Map<string, OrgNode>): Seg[] {
  const cr = canvas.getBoundingClientRect(), out: Seg[] = [];
  const boxes = new Map<string, Box>();
  canvas.querySelectorAll<HTMLElement>(".oc-card[data-key]").forEach(el => { const r = el.getBoundingClientRect(); boxes.set(el.dataset.key!, { key: el.dataset.key!, l: r.left - cr.left, t: r.top - cr.top, r: r.right - cr.left, b: r.bottom - cr.top, cx: r.left - cr.left + r.width / 2, cy: r.top - cr.top + r.height / 2, w: r.width, h: r.height }); });
  for (const l of list) {
    const a = boxes.get(l.from), b = boxes.get(l.to); if (!a || !b) continue; // someone folded away: no line
    const dx = b.cx - a.cx, dy = b.cy - a.cy, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
    // Try gentle arcs first, then wider ones on either side; keep the first that touches no other card, else the one touching fewest.
    let best: { p0: { x: number; y: number }; c: { x: number; y: number }; p1: { x: number; y: number }; hits: number } | null = null;
    for (const k of [0.25, -0.25, 0.45, -0.45, 0.7, -0.7, 1, -1]) {
      const c = { x: mx + nx * len * k, y: my + ny * len * k }, p0 = toward(a, c, 9), p1 = toward(b, c, 6);
      let hits = 0;
      for (const o of boxes.values()) {
        if (o === a || o === b) continue;
        for (let i = 1; i < 24; i++) { const q = quad(p0, c, p1, i / 24); if (q.x > o.l - 3 && q.x < o.r + 3 && q.y > o.t - 3 && q.y < o.b + 3) { hits++; break; } }
      }
      if (!best || hits < best.hits) best = { p0, c, p1, hits };
      if (!hits) break;
    }
    if (!best) continue;
    out.push({ id: l.id, x1: best.p0.x, y1: best.p0.y, cx: best.c.x, cy: best.c.y, x2: best.p1.x, y2: best.p1.y, strength: l.strength, tone: l.tone || "neutral", blue: /Economic Buyer/.test(byKey.get(l.from)?.dealRole || ""), from: l.from, to: l.to, note: l.note });
  }
  return out;
}
const star = (x: number, y: number, blue: boolean) => `<path transform="translate(${x - 7} ${y - 7}) scale(0.58)" d="${STAR}" fill="${blue ? "#8fb8e8" : "#f5c400"}" stroke="#fff" stroke-width="1.5" paint-order="stroke"/>`;
const arrowhead = (x1: number, y1: number, x2: number, y2: number) => { const a = Math.atan2(y2 - y1, x2 - x1), c = Math.cos(a), s = Math.sin(a); return `${x2},${y2} ${x2 - 9 * c + 5 * s},${y2 - 9 * s - 5 * c} ${x2 - 9 * c - 5 * s},${y2 - 9 * s + 5 * c}`; };
const arcPath = (g: Seg) => `M${g.x1} ${g.y1} Q${g.cx} ${g.cy} ${g.x2} ${g.y2}`;
const lineColor = (g: Seg, colored: boolean) => colored ? TONE[g.tone] : GREY;
const lineMarkup = (segs: Seg[], colored: boolean) => segs.map(g => `<path d="${arcPath(g)}" fill="none" stroke="${lineColor(g, colored)}" stroke-width="${lineWidth(g.strength)}" stroke-dasharray="1 5" stroke-linecap="round"/><polygon points="${arrowhead(g.cx, g.cy, g.x2, g.y2)}" fill="${lineColor(g, colored)}"/>${star(g.x1, g.y1, g.blue)}`).join("");
// Four bars like a signal meter; `level` 0 to 4 fills them, 0 = no activity matched (all light grey).
function Meter({ level }: { level: number }) {
  return <span className="oc-meter" role="img" aria-label={level ? `Activity ${level} of 4` : "No activity matched"} title={level ? `Activity ${level} of 4` : "No activity matched"}>{[1, 2, 3, 4].map(i => <i key={i} className={i <= level ? "on" : ""} style={{ height: 4 + i * 3 }} />)}</span>;
}
const LI = "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z";
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const dateText = (d: string) => { if (!d) return "No date"; const x = new Date(d + "T00:00:00"); return isNaN(x.getTime()) ? d : x.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };

const Warn = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#b3261e" d="M12 2 1 21h22z" /><path fill="#fff" d="M11 9h2v6h-2zm0 7h2v2h-2z" /></svg>;
const Star = ({ blue }: { blue: boolean }) => <svg viewBox="0 0 24 24" width="18" height="18" aria-label="Power base"><path fill={blue ? "#8fb8e8" : "#f5c400"} d="M12 2l3 6.6 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.2l1.5-7L2 9.4l7-.8z" /></svg>;

function AddForm({ parentKey, busy, onAdd }: { parentKey: string | null; busy: boolean; onAdd: (name: string, title: string) => void }) {
  const [name, setName] = useState(""), [title, setTitle] = useState("");
  return (
    <form className="oc-form" onSubmit={e => { e.preventDefault(); if (name.trim()) { onAdd(name, title); setName(""); setTitle(""); } }}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" aria-label="Name of the new person" maxLength={80} />
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Job title (optional)" aria-label="Job title of the new person" maxLength={120} />
      <button type="submit" disabled={busy || !name.trim()}>{parentKey ? "Add below this person" : "Add at the top"}</button>
    </form>
  );
}

function EditPanel({ node, nodes, busy, confirmRemove, onAsk, onCancel, onEdit }: { node: OrgNode; nodes: OrgNode[]; busy: boolean; confirmRemove: boolean; onAsk: () => void; onCancel: () => void; onEdit: (edit: OrgEdit) => Promise<boolean | undefined> }) {
  const [type, setType] = useState(mindset(node)), [dealRole, setDealRole] = useState(node.dealRole), [powerBase, setPowerBase] = useState(node.powerBase), [description, setDescription] = useState(node.description);
  const changed = type !== mindset(node) || dealRole !== node.dealRole || powerBase !== node.powerBase || description !== node.description;
  // Not themselves and not anyone below them: that would make a loop.
  const under = new Set<string>([node.key]);
  for (let grew = true; grew;) { grew = false; for (const n of nodes) if (n.parentKey && under.has(n.parentKey) && !under.has(n.key)) { under.add(n.key); grew = true; } }
  return (
    <div className="oc-ed">
      <h4>Edit in Task AI</h4>
      <label>Reports to
        <select value={node.parentKey || ""} disabled={busy} onChange={e => void onEdit({ op: "move", key: node.key, parentKey: e.target.value || null })}>
          <option value="">Nobody (top level)</option>
          {nodes.filter(n => !under.has(n.key)).map(n => <option key={n.key} value={n.key}>{n.name}</option>)}
        </select>
      </label>
      <div className="oc-row">
        <button type="button" disabled={busy} onClick={() => void onEdit({ op: "shift", key: node.key, by: -1 })}>← Move left</button>
        <button type="button" disabled={busy} onClick={() => void onEdit({ op: "shift", key: node.key, by: 1 })}>Move right →</button>
      </div>
      {nodes.some(n => n.parentKey === node.key) && (
        <label>Team layout
          <select value={node.layout || "auto"} disabled={busy} onChange={e => void onEdit({ op: "update", key: node.key, layout: e.target.value })}>
            <option value="auto">Automatic</option><option value="row">Row (side by side)</option><option value="ladder">Ladder (hanging)</option>
          </select>
        </label>
      )}
      <label>Mindset<select value={type} onChange={e => setType(e.target.value)}>{(MINDSETS.includes(type) ? MINDSETS : [...MINDSETS, type]).map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Deal role<input value={dealRole} maxLength={80} onChange={e => setDealRole(e.target.value)} /></label>
      <label className="oc-chk"><input type="checkbox" checked={powerBase} onChange={e => setPowerBase(e.target.checked)} /> Power base</label>
      <label>Notes<textarea rows={3} value={description} maxLength={2000} onChange={e => setDescription(e.target.value)} /></label>
      <button type="button" className="oc-save" disabled={busy || !changed} onClick={() => void onEdit({ op: "update", key: node.key, type, dealRole, powerBase, description })}>Save changes</button>
      <AddForm parentKey={node.key} busy={busy} onAdd={(name, title) => void onEdit({ op: "add", name, title, parentKey: node.key })} />
      {confirmRemove
        ? <p className="oc-ask">Remove {node.name}? Their team moves up one level. <button type="button" disabled={busy} onClick={() => void onEdit({ op: "remove", key: node.key })}>Yes, remove</button><button type="button" onClick={onCancel}>No</button></p>
        : <button type="button" className="oc-del" disabled={busy} onClick={onAsk}>Remove from this chart</button>}
    </div>
  );
}

export default function OrgChartView({ chartId, chart: initial, edited: wasEdited, title, subtitle, startEditing, onEditing, onChanged, influences: initialInfluences }: { chartId: string; chart: ChartData; edited: boolean; title: string; subtitle: string; startEditing: boolean; onEditing: (on: boolean) => void; onChanged: (people: number, edited: boolean) => void; influences: OrgInfluence[] }) {
  const [chart, setChart] = useState<ChartData>(initial);
  const [edited, setEdited] = useState(wasEdited);
  const [editing, setEditing] = useState(startEditing);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; zone: Zone } | null>(null);
  const hoverRef = useRef<{ key: string; zone: Zone } | null>(null); // the same, readable in the drop handler
  const grab = useRef({ dx: 0, dy: 0, w: 0, h: 0 }); // where on the dragged card it was picked up, and its size
  const [pending, setPending] = useState<Pending | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printScale, setPrintScale] = useState(1);
  const sheet = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<"remove" | "reset" | null>(null);
  const [influences, setInfluences] = useState<OrgInfluence[]>(initialInfluences);
  const [lineMode, setLineMode] = useState<"selected" | "all" | "off">("selected");
  const [pdfLines, setPdfLines] = useState(true);
  const [colored, setColored] = useState(false); // "Who influences who" switched on: all lines in the colour of their kind
  const colorPinned = colored;
  const [segs, setSegs] = useState<Seg[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [hoverCard, setHoverCard] = useState<string | null>(null);
  const leaveTimer = useRef(0);
  const [linking, setLinking] = useState<{ from: string; x: number; y: number } | null>(null);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [lineMenu, setLineMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const printCanvas = useRef<HTMLDivElement>(null);
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
  // Everyone under a manager, at any depth. Folding a team hides the whole branch; opening it again opens the whole branch too,
  // or only the next level when Shift is held (the people below stay folded).
  const under = (key: string): OrgNode[] => (kids.get(key) || []).flatMap(k => [k, ...under(k.key)]);
  function toggleTeam(n: OrgNode, oneLevel: boolean) {
    setCollapsed(set => {
      const next = new Set(set);
      if (!next.has(n.key)) { next.add(n.key); return next; }
      next.delete(n.key);
      for (const d of under(n.key)) next.delete(d.key);
      if (oneLevel) for (const k of kids.get(n.key) || []) if ((kids.get(k.key) || []).length) next.add(k.key);
      return next;
    });
  }
  const below = (n: OrgNode): number => (kids.get(n.key) || []).reduce((sum, k) => sum + 1 + below(k), 0);
  // eslint-disable-next-line @next/next/no-img-element
  const photo = (n: OrgNode, eager = false) => n.photo ? <img src={`/api/org-charts/${encodeURIComponent(chartId)}/photo/${encodeURIComponent(n.photo)}`} alt="" loading={eager ? "eager" : "lazy"} onError={e => e.currentTarget.remove()} /> : null;

  function open(key: string) {
    setSelected(key);
    if (!/^003/.test(key) || tasks[key]) return;
    setTasks(t => ({ ...t, [key]: { busy: true } }));
    fetch(`/api/org-charts/${encodeURIComponent(chartId)}/tasks?contact=${encodeURIComponent(key)}`, { credentials: "same-origin" })
      .then(async r => { const res = await r.json().catch(() => ({})); setTasks(t => ({ ...t, [key]: r.ok ? { items: res.items || [] } : { error: res.error || "The tasks could not be read" } })); })
      .catch(() => setTasks(t => ({ ...t, [key]: { error: "Salesforce could not be reached." } })));
  }

  async function send(edit: OrgEdit) {
    setBusy(true); setMsg(""); setConfirm(null);
    const r = await fetch(`/api/org-charts/${encodeURIComponent(chartId)}/edit`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(edit) }).catch(() => null);
    const res = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) { setMsg(res.error || "The change could not be saved"); return false; }
    setChart(res.chart); setEdited(true); if (res.influences) setInfluences(res.influences); onChanged(res.chart.nodes.length, true);
    if (edit.op === "add" && res.key) setSelected(res.key);
    if (edit.op === "remove") setSelected(null);
    return true;
  }
  async function reset() {
    setBusy(true); setMsg(""); setConfirm(null);
    const r = await fetch(`/api/org-charts/${encodeURIComponent(chartId)}/edit`, { method: "DELETE", credentials: "same-origin" }).catch(() => null);
    const res = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) { setMsg(res.error || "The edits could not be undone"); return; }
    setChart({ ...res.chart, salesforceBase: chart.salesforceBase }); setEdited(false); if (res.influences) setInfluences(res.influences); setSelected(null); onChanged(res.chart.nodes.length, false);
  }
  // Dropping someone who has a team asks whether the team moves along, like Salesforce ("Move with hierarchy?").
  function drop(e: React.DragEvent, targetKey: string | null, position: DropPosition) {
    e.preventDefault(); e.stopPropagation();
    const key = dragKey; setDragKey(null); setHover(null); hoverRef.current = null;
    if (!key || key === targetKey) return;
    if ((kids.get(key) || []).length) setPending({ key, targetKey, position });
    else void send({ op: "drop", key, targetKey, position, withTeam: true });
  }
  function confirmDrop(withTeam: boolean) {
    const p = pending; setPending(null);
    if (p) void send({ op: "drop", ...p, withTeam });
  }
  const askFocus = (el: HTMLButtonElement | null) => el?.focus();
  // While a card is dragged, the chart scrolls when the pointer gets near its edge.
  useEffect(() => {
    if (!dragKey) return;
    // The whole dragged card counts, not just the pointer: the target is the card it overlaps most (with the drop areas around
    // it), and the side it is held towards picks the area.
    function locate(x: number, y: number) {
      const el = wrap.current; if (!el || !dragKey) return;
      const wr = el.getBoundingClientRect();
      let best: { key: string; zone: Zone } | null = null;
      const rz = el.querySelector(".oc-rootzone")?.getBoundingClientRect();
      if (rz && x >= rz.left && x <= rz.right && y >= rz.top && y <= rz.bottom) best = { key: ROOT, zone: "top" };
      else if (x >= wr.left && x <= wr.right && y >= wr.top && y <= wr.bottom) {
        const g = grab.current, gl = x - g.dx, gt = y - g.dy, margin = 28;
        let most = g.w * g.h * 0.12;
        for (const c of el.querySelectorAll<HTMLElement>(".oc-card[data-key]")) {
          if (c.dataset.key === dragKey) continue;
          const r = c.getBoundingClientRect();
          const area = Math.max(0, Math.min(gl + g.w, r.right + margin) - Math.max(gl, r.left - margin)) * Math.max(0, Math.min(gt + g.h, r.bottom + margin) - Math.max(gt, r.top - margin));
          if (area <= most) continue;
          most = area;
          const dxp = gl + g.w / 2 - (r.left + r.width / 2), dyp = gt + g.h / 2 - (r.top + r.height / 2), ax = Math.abs(dxp) / r.width, ay = Math.abs(dyp) / r.height;
          const spot = ax < 0.25 && ay < 0.25 ? "bottom" : ax > ay ? (dxp < 0 ? "left" : "right") : dyp < 0 ? "top" : "bottom";
          const zone = (c.dataset.ladder ? LADDER_PADS : PADS).find(p => p.spot === spot)!.zone;
          best = { key: c.dataset.key!, zone };
        }
      }
      hoverRef.current = best;
      setHover(h => h?.key === best?.key && h?.zone === best?.zone ? h : best);
    }
    let x = 0, y = 0;
    const at = (e: DragEvent) => { x = e.clientX; y = e.clientY; locate(x, y); };
    const tick = window.setInterval(() => {
      const el = wrap.current; if (!el) return;
      const r = el.getBoundingClientRect(), edge = 70, speed = (d: number) => Math.ceil(Math.min(1, (edge - d) / edge) * 22);
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      if (x - r.left < edge) el.scrollLeft -= speed(x - r.left); else if (r.right - x < edge) el.scrollLeft += speed(r.right - x);
      if (y - r.top < edge) el.scrollTop -= speed(y - r.top); else if (r.bottom - y < edge) el.scrollTop += speed(r.bottom - y);
    }, 16);
    document.addEventListener("dragover", at);
    return () => { window.clearInterval(tick); document.removeEventListener("dragover", at); };
  }, [dragKey]);

  async function sendLine(edit: InfluenceEdit, at?: { x: number; y: number }) {
    setMsg("");
    const r = await fetch(`/api/org-charts/${encodeURIComponent(chartId)}/influences`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(edit) }).catch(() => null);
    const res = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setMsg(res.error || "The line could not be saved"); return false; }
    setInfluences(res.influences);
    if (edit.op === "remove") setLineMenu(null);
    else if (edit.op === "add" && res.id) { setSelected(edit.from); if (at) setLineMenu({ id: res.id, x: at.x, y: at.y }); }
    return true;
  }
  // Which lines show: those of the selected person (default), all of them, or none.
  const shown = useMemo(() => lineMode === "all" || colored ? influences : lineMode === "off" ? [] : influences.filter(l => l.from === selected || l.to === selected || l.id === lineMenu?.id), [influences, lineMode, colored, selected, lineMenu?.id]);
  const lineKey = shown.map(l => `${l.id}${l.from}${l.to}${l.strength}${l.tone || ""}`).join(",");
  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const measure = () => { setSegs(lineSegs(el, shown, byKey)); setCanvasSize({ w: el.scrollWidth, h: el.scrollHeight }); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey, byKey, collapsed, zoom, editing]);
  // Dragging from the handle on a card to another card: this person influences that one. Esc cancels.
  const linkFrom = linking?.from;
  useEffect(() => {
    if (!linkFrom) return;
    const cardAt = (x: number, y: number) => document.elementsFromPoint(x, y).map(e => e.closest<HTMLElement>(".oc-card[data-key]")).find(Boolean)?.dataset.key || null;
    const point = (e: MouseEvent) => { const cr = canvas.current?.getBoundingClientRect(); return { x: e.clientX - (cr?.left || 0), y: e.clientY - (cr?.top || 0) }; };
    const move = (e: MouseEvent) => { setLinking(l => l && { ...l, ...point(e) }); setLinkTarget(cardAt(e.clientX, e.clientY)); };
    const up = (e: MouseEvent) => { const to = cardAt(e.clientX, e.clientY); setLinking(null); setLinkTarget(null); if (to && to !== linkFrom) void sendLine({ op: "add", from: linkFrom, to }, point(e)); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setLinking(null); setLinkTarget(null); } };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.removeEventListener("keydown", key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkFrom]);

  function pan(e: React.MouseEvent) {
    const el = wrap.current;
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest(".oc-card, .oc-chev, .oc-line, .oc-handle, .oc-linemenu")) return;
    const x = e.clientX, y = e.clientY, l = el.scrollLeft, t = el.scrollTop;
    el.classList.add("pan");
    const move = (m: MouseEvent) => { el.scrollLeft = l - (m.clientX - x); el.scrollTop = t - (m.clientY - y); };
    const up = () => { el.classList.remove("pan"); document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }

  // PDF: the whole chart (every team open, no side panel) is drawn in a hidden sheet, scaled to fit a landscape page, and the
  // browser's print dialog opens so it can be saved as PDF (same way as the Close Plan report, with real vector text).
  useEffect(() => {
    if (!printing) return;
    const el = sheet.current; if (!el) return;
    const tree = el.querySelector<HTMLElement>(".oc-tree"); if (!tree) return;
    const w = tree.scrollWidth, h = tree.scrollHeight, pageW = 1040, pageH = 620; // landscape A4 inside 10 mm margins, minus the heading
    const fit = Math.min(1, pageW / w, pageH / h), scale = fit >= 0.4 ? fit : Math.min(1, pageW / w);
    setPrintScale(scale);
    const oldTitle = document.title; document.title = `Org chart ${title}`; document.body.classList.add("oc-printing");
    // Landscape only for this print: a named page would start the sheet on a second page after an empty portrait one.
    const pageRule = document.createElement("style"); pageRule.textContent = "@page{size:A4 landscape;margin:10mm}"; document.head.appendChild(pageRule);
    let done = false;
    const finish = () => { if (done) return; done = true; pageRule.remove(); document.title = oldTitle; document.body.classList.remove("oc-printing"); window.removeEventListener("afterprint", finish); setPrinting(false); };
    window.addEventListener("afterprint", finish);
    const images = [...el.querySelectorAll("img")].filter(i => !i.complete).map(i => new Promise<void>(ok => { i.onload = i.onerror = () => ok(); }));
    void Promise.race([Promise.all(images), new Promise(ok => window.setTimeout(ok, 5000))]).then(() => window.setTimeout(() => { if (done) return; const box = printCanvas.current, layer = box?.querySelector<HTMLElement>(".oc-print-lines"); if (box && layer && pdfLines && influences.length) layer.innerHTML = `<svg width="${box.scrollWidth}" height="${box.scrollHeight}">${lineMarkup(lineSegs(box, influences, byKey), colorPinned)}</svg>`; window.print(); finish(); }, 250));
    return () => { done = true; pageRule.remove(); window.removeEventListener("afterprint", finish); document.body.classList.remove("oc-printing"); document.title = oldTitle; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing, title]);

  const inner = (n: OrgNode, eager = false) => (
    <>
      {n.provisional && <span className="oc-tmp">Temp</span>}
      <div className="oc-av">{initials(n.name)}{photo(n, eager)}</div>
      <div className="oc-tx"><div className="oc-nm">{n.name}</div><div className="oc-ds">{n.title}</div><div className="oc-ft"><span className="oc-rl">{n.dealRole}</span><Meter level={n.activity || 0} /></div></div>
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
    </>
  );

  const card = (n: OrgNode, ladder = false) => (
    <div data-key={n.key} data-ladder={ladder ? "1" : undefined} className={`oc-card${selected === n.key ? " sel" : ""}${dragKey === n.key ? " drag" : ""}${hover?.key === n.key ? " active" : ""}${linkTarget === n.key && linking?.from !== n.key ? " link-target" : ""}`} onMouseEnter={() => { window.clearTimeout(leaveTimer.current); setHoverCard(n.key); }} onMouseLeave={() => { window.clearTimeout(leaveTimer.current); leaveTimer.current = window.setTimeout(() => setHoverCard(h => h === n.key ? null : h), 350); }} tabIndex={0} role="button" aria-label={`${n.name}, show details`} style={{ borderLeftColor: edge(n) }}
      draggable={editing && !busy} onDragStart={e => { const r = e.currentTarget.getBoundingClientRect(); grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height }; e.dataTransfer.setData("text/plain", n.key); e.dataTransfer.effectAllowed = "move"; setDragKey(n.key); }}
      onDragEnd={() => { setDragKey(null); setHover(null); hoverRef.current = null; }}
      onClick={() => open(n.key)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(n.key); } }}>
      {editing && dragKey && hover?.key === n.key && (ladder ? LADDER_PADS : PADS).map(p => <span key={p.spot} className={`oc-pad ${p.spot}${hover?.key === n.key && hover.zone === p.zone ? " on" : ""}`}>{p.label}</span>)}
      {inner(n)}
    </div>
  );

  // One person and, under them, their team: a row, or a ladder (see app/lib/org-chart-layout.ts). `plain` is the PDF sheet:
  // every team open, nothing clickable.
  const node = (n: OrgNode, level: number, inLadder: boolean, plain: boolean): React.ReactNode => {
    const k = kids.get(n.key) || [], shut = !plain && collapsed.has(n.key);
    const plan: TeamPlan = planTeam(n, level, key => kids.get(key) || []);
    const deeper = (list: OrgNode[]) => list.map(c => node(c, level + 1, list === plan.ladder, plain));
    return (
      <li key={n.key}>
        {plain ? <div className="oc-card" data-key={n.key} style={{ borderLeftColor: edge(n) }}>{inner(n, true)}</div> : card(n, inLadder)}
        {!plain && k.length > 0 && (
          <button type="button" className={`oc-chev${shut ? " shut" : ""}`} aria-expanded={!shut} aria-label={`${shut ? "Show" : "Hide"} the team of ${n.name}`} title={shut ? `Show all ${below(n)} below (Shift: only the next level)` : `Hide all ${below(n)} below`}
            onClick={e => { e.stopPropagation(); toggleTeam(n, e.shiftKey); }}>
            {shut ? <b>+{below(n)}</b> : "⌃"}
          </button>
        )}
        {k.length > 0 && !shut && (plan.layout === "ladder"
          ? <ul className="oc-ladder">{deeper(plan.ladder)}</ul>
          : <ul>
              {deeper(plan.row)}
              {plan.ladder.length > 0 && <li key="group" className="oc-group"><div className="oc-grp">{plan.ladder.length} people without a team</div><ul className="oc-ladder">{deeper(plan.ladder)}</ul></li>}
            </ul>)}
      </li>
    );
  };
  const treeOf = (plain: boolean) => chart.roots.map(k => byKey.get(k)).filter((n): n is OrgNode => Boolean(n)).map(n => node(n, 1, false, plain));

  const handleCard = linking?.from || (editing && !dragKey ? hoverCard : null);
  const [handleAt, setHandleAt] = useState<{ x: number; y: number; from: string } | null>(null);
  useEffect(() => {
    const box = canvas.current, el = handleCard && box ? box.querySelector<HTMLElement>(`.oc-card[data-key="${CSS.escape(handleCard)}"]`) : null;
    if (!box || !el || !handleCard) { setHandleAt(null); return; }
    const r = el.getBoundingClientRect(), cr = box.getBoundingClientRect();
    setHandleAt({ x: r.right - cr.left + 11, y: r.top - cr.top + r.height / 2, from: handleCard });
  }, [handleCard, collapsed, zoom, editing, chart]);
  const menuLine = lineMenu ? influences.find(l => l.id === lineMenu.id) : null;
  const overlay = (
    <>
      <svg className="oc-lines" width={canvasSize.w} height={canvasSize.h} aria-hidden="true">
        {segs.map(g => (
          <g key={g.id}>
            <path d={arcPath(g)} fill="none" stroke={lineColor(g, colored)} strokeWidth={lineWidth(g.strength)} strokeDasharray="1 5" strokeLinecap="round" />
            <polygon points={arrowhead(g.cx, g.cy, g.x2, g.y2)} fill={lineColor(g, colored)} />
            <path transform={`translate(${g.x1 - 7} ${g.y1 - 7}) scale(0.58)`} d={STAR} fill={g.blue ? "#8fb8e8" : "#f5c400"} stroke="#fff" strokeWidth="1.5" paintOrder="stroke" />
            <path className="oc-line" d={arcPath(g)} fill="none" stroke="transparent" strokeWidth="14" onClick={e => { const cr = canvas.current?.getBoundingClientRect(); setLineMenu({ id: g.id, x: e.clientX - (cr?.left || 0), y: e.clientY - (cr?.top || 0) }); }}><title>{`${byKey.get(g.from)?.name} influences ${byKey.get(g.to)?.name} (${TONE_LABEL[g.tone].toLowerCase()})${g.note ? `: ${g.note}` : ""}`}</title></path>
          </g>
        ))}
        {linking && handleAt && <line x1={handleAt.x} y1={handleAt.y} x2={linking.x} y2={linking.y} stroke={GREY} strokeWidth="2" strokeDasharray="1 5" strokeLinecap="round" />}
        {editing && handleAt && (
          <g className="oc-handle" onMouseEnter={() => window.clearTimeout(leaveTimer.current)} onMouseLeave={() => { if (!linking) setHoverCard(null); }} onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setLinking({ from: handleAt.from, x: handleAt.x, y: handleAt.y }); }}>
            <circle cx={handleAt.x} cy={handleAt.y} r="9" fill="#fff" stroke={GREY} strokeWidth="2" /><path transform={`translate(${handleAt.x - 6} ${handleAt.y - 6}) scale(0.5)`} d={STAR} fill="#f5c400" /><title>Drag onto another person: this person influences them</title>
          </g>
        )}
      </svg>
      {menuLine && lineMenu && (
        <div className="oc-linemenu" style={{ left: Math.max(4, lineMenu.x - 100), top: lineMenu.y + 8 }} role="dialog" aria-label="Influence line">
          <b>{byKey.get(menuLine.from)?.name} → {byKey.get(menuLine.to)?.name}</b>
          <div className="oc-row">{([3, 2, 1] as const).map(v => <button key={v} type="button" className={menuLine.strength === v ? "on" : ""} disabled={!editing} onClick={() => void sendLine({ op: "update", id: menuLine.id, strength: v })}>{v === 3 ? "Strong" : v === 2 ? "Medium" : "Weak"}</button>)}</div>
          <div className="oc-row">{(["positive", "neutral", "negative"] as const).map(t => <button key={t} type="button" className={`oc-tone ${t}${(menuLine.tone || "neutral") === t ? " on" : ""}`} disabled={!editing} onClick={() => void sendLine({ op: "update", id: menuLine.id, tone: t })}>{TONE_LABEL[t]}</button>)}</div>
          <input defaultValue={menuLine.note} maxLength={300} placeholder="Note, for example how they influence" aria-label="Note" disabled={!editing} onBlur={e => { if (e.target.value !== menuLine.note) void sendLine({ op: "update", id: menuLine.id, note: e.target.value }); }} />
          <div className="oc-row">{editing && <button type="button" onClick={() => void sendLine({ op: "reverse", id: menuLine.id })}>Reverse</button>}{editing && <button type="button" className="oc-del" onClick={() => void sendLine({ op: "remove", id: menuLine.id })}>Delete</button>}<button type="button" onClick={() => setLineMenu(null)}>Close</button></div>
          {!editing && <p className="oc-hint">Press Edit chart to change this line.</p>}
        </div>
      )}
    </>
  );

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
        {chart.nodes.some(n => n.parentKey) && <button type="button" onClick={() => setCollapsed(new Set(chart.nodes.filter(n => !n.parentKey && (kids.get(n.key) || []).length).map(n => n.key)))}>Collapse all</button>}
        <label className="oc-sel">Influence lines <select value={lineMode} onChange={e => setLineMode(e.target.value as "selected" | "all" | "off")}><option value="selected">Selected person</option><option value="all">All ({influences.length})</option><option value="off">Off</option></select></label>
        <label className="oc-switch" title="Show who influences whom in colour: red negative, blue neutral, green positive"><input type="checkbox" role="switch" checked={colored} onChange={e => setColored(e.target.checked)} /><span className="oc-track" aria-hidden="true" />Who influences who</label>

        <label className="oc-sel"><input type="checkbox" checked={pdfLines} onChange={e => setPdfLines(e.target.checked)} /> Lines in PDF</label>
        <button type="button" disabled={printing || !chart.nodes.length} onClick={() => setPrinting(true)}>{printing ? "Preparing PDF…" : "Export PDF"}</button>
        <button type="button" className={editing ? "on" : ""} aria-pressed={editing} onClick={() => { onEditing(!editing); setEditing(v => !v); setMsg(""); setConfirm(null); }}>{editing ? "Done editing" : "Edit chart"}</button>
        {edited && (confirm === "reset"
          ? <span className="oc-ask">Throw away all edits? <button type="button" disabled={busy} onClick={() => void reset()}>Yes, reset</button><button type="button" onClick={() => setConfirm(null)}>No</button></span>
          : <button type="button" disabled={busy} onClick={() => setConfirm("reset")}>Reset to Salesforce copy</button>)}
      </div>
      {edited && <p className="oc-note">Edited in Task AI. These changes are saved here only and are not in Salesforce.</p>}
      {editing && (
        <div className="oc-edit">
          <p className="oc-hint">Drag a card over another card: hold it above to make them its manager, to the left or right to put them beside it, or centred to make them report to it. The card and the area light up before you let go. Drop it on the bar at the top to make them top level; dropped anywhere else, nothing changes. Click a card to change type, role and notes, move it left or right, or remove it.</p>
          <AddForm parentKey={null} busy={busy} onAdd={(name, title) => void send({ op: "add", name, title, parentKey: null })} />
        </div>
      )}
      {msg && <p className="oc-err" role="alert">{msg}</p>}
      {pending && (() => {
        const who = byKey.get(pending.key), team = (kids.get(pending.key) || []).length, boss = who?.parentKey ? byKey.get(who.parentKey)?.name : "";
        return (
          <div className="oc-modal" role="presentation">
            <div role="dialog" aria-modal="true" aria-label="Move with team?">
              <h4>Move {who?.name} with their team?</h4>
              <p>{who?.name} has {team} {team === 1 ? "person" : "people"} reporting directly. Move the whole team along, or move {who?.name} alone and let the team report to {boss || "nobody (top level)"}?</p>
              <div className="oc-row">
                <button type="button" className="oc-save" ref={askFocus} onClick={() => confirmDrop(true)}>Move with team</button>
                <button type="button" onClick={() => confirmDrop(false)}>Move alone</button>
                <button type="button" onClick={() => setPending(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
      <div className="oc-main">
                {colored && <span className="oc-legend float" aria-label="Colours of the influence lines"><i style={{ borderColor: TONE.negative }} />Negative<i style={{ borderColor: TONE.neutral }} />Neutral<i style={{ borderColor: TONE.positive }} />Positive</span>}
        <div className={`oc-wrap${editing ? " editing" : ""}`} ref={wrap} role="presentation" onMouseDown={pan} onDragOver={e => { if (editing && dragKey) e.preventDefault(); }} onDrop={e => { if (!editing || !dragKey) return; const h = hoverRef.current; if (!h) { e.preventDefault(); setDragKey(null); setHover(null); return; } drop(e, h.key === ROOT ? null : h.key, h.key === ROOT ? "root" : h.zone); }}><div className="oc-canvas" ref={canvas}>{editing && dragKey && byKey.get(dragKey)?.parentKey && <div className="oc-rootzone-wrap"><div className={`oc-rootzone${hover?.key === ROOT ? " on" : ""}`}>Drop here to make {byKey.get(dragKey)?.name} top level</div></div>}<ul className={`oc-tree${editing ? " editing" : ""}`} style={{ zoom }}>{treeOf(false)}</ul>{overlay}</div></div>
        {sel && (
          <aside className="oc-panel" aria-label={sel.name}>
            <button type="button" className="oc-x" aria-label="Close details" onClick={() => setSelected(null)}>×</button>
            <div className="oc-ph"><div className="oc-av big">{initials(sel.name)}{photo(sel)}</div><div><h3>{sel.name}</h3><p>{sel.title}</p></div></div>
            {sel.left && <p className="oc-left"><Warn /> Salesforce says this contact left the organization.</p>}
            {row("Mindset", mindset(sel))}{row("Deal role", sel.dealRole)}{row("Power base", sel.powerBase ? "Yes" : "")}{row("Reports to", parent?.name)}{row("Direct reports", team ? String(team) : "")}
            {row("Email", sel.email && <a href={`mailto:${sel.email}`}>{sel.email}</a>)}{row("Phone", sel.phone)}{row("Notes", sel.description)}
            <div className="oc-links">
              {chart.salesforceBase && /^003/.test(sel.key) && <a className="oc-btn" href={`${chart.salesforceBase}/lightning/r/Contact/${encodeURIComponent(sel.key)}/view`} target="_blank" rel="noopener noreferrer">Go to contact in Salesforce ↗</a>}
              {sel.linkedin && <a className="oc-btn" href={sel.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn profile ↗</a>}
            </div>
            {editing && <EditPanel key={sel.key} node={sel} nodes={chart.nodes} busy={busy} confirmRemove={confirm === "remove"} onAsk={() => setConfirm("remove")} onCancel={() => setConfirm(null)} onEdit={edit => send(edit)} />}
            <h4>Influence</h4>
            {(() => {
              const out = influences.filter(l => l.from === sel.key), into = influences.filter(l => l.to === sel.key);
              const taken = new Set([sel.key, ...out.map(l => l.to), ...into.map(l => l.from)]);
              const line = (l: OrgInfluence, other: string) => <li key={l.id}><button type="button" className="oc-lk" onClick={() => setSelected(other)}>{byKey.get(other)?.name}</button><small><i className="oc-dot" style={{ borderColor: TONE[l.tone || "neutral"] }} />{TONE_LABEL[l.tone || "neutral"]} · {l.strength === 3 ? "strong" : l.strength === 2 ? "medium" : "weak"}{l.note ? ` · ${l.note}` : ""}</small>{editing && <button type="button" className="oc-x2" aria-label={`Remove the line with ${byKey.get(other)?.name}`} onClick={() => void sendLine({ op: "remove", id: l.id })}>×</button>}</li>;
              const add = (label: string, make: (k: string) => InfluenceEdit) => editing && <select aria-label={label} value="" onChange={e => { if (e.target.value) void sendLine(make(e.target.value)); }}><option value="">{label}</option>{chart.nodes.filter(n => !taken.has(n.key)).map(n => <option key={n.key} value={n.key}>{n.name}</option>)}</select>;
              return (
                <div className="oc-inf">
                  <p><b>Influences</b></p>{out.length ? <ul>{out.map(l => line(l, l.to))}</ul> : <p className="oc-hint">Nobody yet.</p>}{add("+ Add someone they influence", k => ({ op: "add", from: sel.key, to: k }))}
                  <p><b>Influenced by</b></p>{into.length ? <ul>{into.map(l => line(l, l.from))}</ul> : <p className="oc-hint">Nobody yet.</p>}{add("+ Add someone who influences them", k => ({ op: "add", from: k, to: sel.key }))}
                </div>
              );
            })()}
            <h4>Activity <button type="button" className="oc-info" aria-label="About activity" title={ACTIVITY_NOTE}>i</button></h4>
            <div className="oc-act"><Meter level={sel.activity || 0} /><span>{sel.activity ? `${sel.activity} of 4` : "No activity matched"}</span></div>
            <h4>Open tasks and events in Salesforce <em>{sel.provisional ? "" : sel.openTasks || 0}</em></h4>
            {sel.provisional ? <p className="oc-hint">A placeholder contact has no tasks in Salesforce.</p>
              : !t || t.busy ? <p className="oc-hint">Reading Salesforce…</p>
              : t.error ? <p className="oc-err">{t.error}</p>
              : !t.items?.length ? <p className="oc-hint">No open tasks or upcoming events with this person.</p>
              : <ul className="oc-tl">{t.items.map(i => <li key={i.id}><b>{i.subject}</b><small>{i.kind} · {dateText(i.when)}{i.status && i.kind === "Task" ? ` · ${i.status}` : ""}{i.owner ? ` · ${i.owner}` : ""}</small></li>)}</ul>}
          </aside>
        )}
      </div>
      <p className="oc-hint">{chart.nodes.length} {chart.nodes.length === 1 ? "person" : "people"}. Click a card for details, drag the background to move around.{edited ? "" : " Press Edit chart to change this copy."}</p>
      {printing && createPortal(
        <div className="oc-print-root" ref={sheet}>
          <h1>{title}</h1>
          <p>{subtitle}{subtitle ? " · " : ""}{chart.nodes.length} {chart.nodes.length === 1 ? "person" : "people"}{edited ? " · edited in Task AI, not saved in Salesforce" : ""}</p>
          <div className="oc-print-canvas" ref={printCanvas}><ul className="oc-tree" style={{ zoom: printScale }}>{treeOf(true)}</ul><div className="oc-print-lines" /></div>
        </div>, document.body)}
      {chart.issues.length > 0 && <details className="oc-hint"><summary>{chart.issues.length} {chart.issues.length === 1 ? "thing" : "things"} to check in Salesforce</summary><ul style={{ paddingLeft: 18 }}>{chart.issues.map((i, k) => <li key={k}>{i.text}</li>)}</ul></details>}
    </div>
  );
}
