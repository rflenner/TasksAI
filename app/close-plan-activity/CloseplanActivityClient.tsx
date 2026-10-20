"use client";
import { useCallback, useEffect, useState } from "react";

type Row = { id: number; at: string; planId: string | null; planTitle: string | null; personName: string; side: string; via: string; event: string; taskId: string | null; taskTitle: string | null; detail: string | null };
const EVENTS: Record<string, string> = { login: "Signed in", plan_opened: "Opened the plan", task_opened: "Opened a task", file_viewed: "Viewed a file", file_downloaded: "Downloaded a file", file_added: "Added a file", file_removed: "Removed a file", changes_saved: "Changed the plan" };
const WORK = new Set(["changes_saved", "file_added", "file_removed"]);
const input = "border border-[#c9d3e0] rounded px-3 py-1.5 text-sm bg-white";
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function what(r: Row) {
  const task = r.taskTitle ? `“${r.taskTitle}”` : "";
  switch (r.event) {
    case "login": return "Signed in to Task AI";
    case "plan_opened": return "Opened the plan";
    case "task_opened": return `Opened ${task || "a task"}`;
    case "file_viewed": return `Viewed ${r.detail || "a file"}${task ? ` on ${task}` : ""}`;
    case "file_downloaded": return `Downloaded ${r.detail || "a file"}${task ? ` from ${task}` : ""}`;
    case "file_added": return `Added ${r.detail || "a file"}${task ? ` to ${task}` : ""}`;
    case "file_removed": return `Removed ${r.detail || "a file"}${task ? ` from ${task}` : ""}`;
    case "changes_saved": return `Changed: ${r.detail || "the plan"}`;
    default: return r.event;
  }
}

export default function CloseplanActivityClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [more, setMore] = useState(false);
  const [plans, setPlans] = useState<Array<{ id: string; title: string }>>([]);
  const [plan, setPlan] = useState(""), [who, setWho] = useState(""), [event, setEvent] = useState(""), [days, setDays] = useState("7");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async (append: Row[] | null) => {
    const q = new URLSearchParams();
    if (plan) q.set("plan", plan); if (who.trim()) q.set("who", who.trim()); if (event) q.set("event", event); if (days) q.set("days", days);
    if (append && append.length) q.set("before", String(append[append.length - 1].id));
    if (!append) q.set("facets", "1");
    setState("loading");
    const r = await fetch(`/api/close-plans/access-log?${q}`, { credentials: "same-origin" });
    if (!r.ok) { setState("error"); return; }
    const d = await r.json();
    setRows(append ? [...append, ...d.rows] : d.rows); setMore(d.hasMore); if (d.plans) setPlans(d.plans); setState("ok");
  }, [plan, who, event, days]);

  useEffect(() => { const t = setTimeout(() => void load(null), who ? 300 : 0); return () => clearTimeout(t); }, [load, who]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select aria-label="Plan" className={input} value={plan} onChange={e => setPlan(e.target.value)}><option value="">All plans</option>{plans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
        <input aria-label="Person" className={input} placeholder="Search a person" value={who} onChange={e => setWho(e.target.value)} />
        <select aria-label="What" className={input} value={event} onChange={e => setEvent(e.target.value)}><option value="">Everything</option>{Object.entries(EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Period" className={input} value={days} onChange={e => setDays(e.target.value)}><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="">All time</option></select>
        <button className={`${input} cursor-pointer`} onClick={() => void load(null)}>Refresh</button>
      </div>
      <div className="border border-[#e3e8ee] bg-white rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] tracking-wider text-[#697181] bg-[#f5f7fa]"><th className="px-4 py-2.5 font-bold">WHEN</th><th className="px-4 py-2.5 font-bold">WHO</th><th className="px-4 py-2.5 font-bold">PLAN</th><th className="px-4 py-2.5 font-bold">WHAT</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-[#eef1f5] align-top">
                <td className="px-4 py-2.5 whitespace-nowrap text-[#4a5568]">{when(r.at)}</td>
                <td className="px-4 py-2.5"><b className="text-[#102f59]">{r.personName}</b><div className="text-[11px] text-[#7a8492]">{r.side === "buyer" ? "Customer · personal link" : "iSEEit · Task AI"}</div></td>
                <td className="px-4 py-2.5 text-[#4a5568]">{r.planTitle || "—"}</td>
                <td className={`px-4 py-2.5 ${WORK.has(r.event) ? "text-[#102f59] font-semibold" : "text-[#2b3445]"}`}>{what(r)}</td>
              </tr>
            ))}
            {!rows.length && state !== "loading" && <tr><td colSpan={4} className="px-4 py-8 text-center text-[#697181]">{state === "error" ? "The log could not be loaded." : "Nothing logged for this selection yet."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center gap-3">
        {more && <button className={`${input} cursor-pointer`} onClick={() => void load(rows)}>Show older</button>}
        {state === "loading" && <span className="text-sm text-[#697181]">Loading…</span>}
      </div>
    </div>
  );
}
