import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import {
  isChange, loadVoiceAuditSessions, parseAuditFilters, rowLabel, summarizeSessions, VOICE_AUDIT_MAX_ROWS, VOICE_AUDIT_RETENTION_DAYS,
  type RowTone, type VoiceAuditRecord,
} from "../lib/voice-audit";
import ExportButtons from "./ExportButtons";
import LocalTime from "./LocalTime";

export const dynamic = "force-dynamic";

// Voice audit trail viewer (requested 2026-10-02, "an audit trail what was
// created, changed and done by voice live and what did not ... good to
// debug"). Site admins only: it holds transcripts of what people said.
const TONE: Record<RowTone, string> = {
  good: "bg-[#e4f4eb] text-[#25784b]", neutral: "bg-[#f2f4f7] text-[#202735]",
  warn: "bg-[#fff1d6] text-[#9b5d00]", bad: "bg-[#fdf1ef] text-[#a84235]", info: "bg-[#eef3fa] text-[#173f76]",
};
const SOURCE_LABEL: Record<string, string> = { live: "🔴 Live Voice Assistant", ask: "🗣️ Ask Task AI" };
const PERIODS: Array<[string, number]> = [["24 hours", 1], ["7 days", 7], ["30 days", 30], [`${VOICE_AUDIT_RETENTION_DAYS} days`, VOICE_AUDIT_RETENTION_DAYS]];
const MAX_SESSIONS = 100;

function href(params: { source: string; show: string; days: number }) {
  const query = new URLSearchParams();
  if (params.source !== "all") query.set("source", params.source);
  if (params.show !== "all") query.set("show", params.show);
  if (params.days !== 7) query.set("days", String(params.days));
  const text = query.toString();
  return `/voice-audit${text ? `?${text}` : ""}`;
}

function Choice({ label, active, to }: { label: string; active: boolean; to: string }) {
  return <a href={to} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${active ? "bg-[#173f76] text-white border-[#173f76]" : "bg-white text-[#173f76] border-[#d7dce3]"}`}>{label}</a>;
}

function Details({ row }: { row: VoiceAuditRecord }) {
  const changes = Array.isArray(row.detail.changes) ? (row.detail.changes as string[]) : [];
  const pending = row.detail.pendingNotify as { to?: string; channel?: string; message?: string } | undefined;
  const notify = row.event === "confirmation" && row.mode === "notify" ? (row.detail as { to?: string; channel?: string; message?: string }) : null;
  const target = pending ?? notify;
  return (
    <>
      {changes.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-[#25784b]">{changes.map((line, i) => <li key={i}>{line}</li>)}</ul>}
      {row.detail.createdSubject ? <div className="mt-1 text-xs text-[#25784b]">Created: {String(row.detail.createdSubject)}</div> : null}
      {target?.to && <div className="mt-1 text-xs text-[#697181]">To {target.to} via {target.channel}: “{(target.message || "").replace(/\s+/g, " ").slice(0, 200)}”</div>}
      {row.detail.error ? <div className="mt-1 text-xs text-[#a84235]">{String(row.detail.error)}</div> : null}
    </>
  );
}

export default async function VoiceAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/voice-audit");
  if (actor.role !== "site_admin") redirect("/");

  // The same filters + loader the export endpoint uses, so "Copy as text"
  // is exactly what's on this page.
  const filters = parseAuditFilters(await searchParams);
  const { source, show, days } = filters;
  const { sessions, rowLimitHit } = await loadVoiceAuditSessions(filters);
  const shown = sessions.slice(0, MAX_SESSIONS);
  const exportQuery = new URLSearchParams({ source, show, days: String(days) }).toString();
  const totals = summarizeSessions(sessions);

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex gap-4"><Link href="/" className="text-sm text-[#697181]">← Back to Task AI</Link><Link href="/voice-requests" className="text-sm text-[#173f76] font-semibold">Voice requests →</Link></div>
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76] mt-4">VOICE</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-1 mb-1">Voice audit trail</h1>
      <p className="text-[#697181] mb-5 max-w-3xl">What the voice assistants heard, what Task AI actually did about it — and what it didn&apos;t. Sessions are newest first; inside a session, rows read in order. “Heard” is a separate transcript of the audio, so it can differ slightly from what the assistant understood (the row it acted on shows that). Kept {VOICE_AUDIT_RETENTION_DAYS} days.</p>

      <div className="flex flex-wrap gap-x-6 gap-y-3 mb-5">
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold uppercase tracking-wide text-[#8b929d]">Assistant</span>
          <Choice label="Both" active={source === "all"} to={href({ source: "all", show, days })} />
          <Choice label="Live Voice" active={source === "live"} to={href({ source: "live", show, days })} />
          <Choice label="Ask Task AI" active={source === "ask"} to={href({ source: "ask", show, days })} />
        </div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold uppercase tracking-wide text-[#8b929d]">Show</span>
          <Choice label="Everything" active={show === "all"} to={href({ source, show: "all", days })} />
          <Choice label="Only changes" active={show === "changes"} to={href({ source, show: "changes", days })} />
          <Choice label="Only problems" active={show === "problems"} to={href({ source, show: "problems", days })} />
        </div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold uppercase tracking-wide text-[#8b929d]">Period</span>
          {PERIODS.map(([label, value]) => <Choice key={value} label={label} active={days === value} to={href({ source, show, days: value })} />)}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-[#4a5160] mb-6">
        <span><b className="text-[#173f76]">{totals.sessions}</b> session{totals.sessions === 1 ? "" : "s"}</span>
        <span><b className="text-[#25784b]">{totals.changes}</b> change{totals.changes === 1 ? "" : "s"} made</span>
        <span><b className="text-[#a84235]">{totals.problems}</b> problem{totals.problems === 1 ? "" : "s"}</span>
        {rowLimitHit && <span className="text-[#9b5d00]">Showing the newest {VOICE_AUDIT_MAX_ROWS} events only — narrow the period to see more.</span>}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-[#8b929d]">Share</span>
        <ExportButtons query={exportQuery} />
        <span className="text-xs text-[#8b929d]">Exports exactly what these filters show, as plain text.</span>
      </div>

      {!shown.length && <div className="border border-[#e3e8ee] bg-white rounded-lg p-6 text-[#697181]">Nothing recorded for these filters yet. Talk to either voice assistant and it shows up here.</div>}

      <div className="space-y-5">
        {shown.map(session => (
          <section key={session.key} className="border border-[#e3e8ee] bg-white rounded-xl overflow-hidden">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 bg-[#f6f8fa] border-b border-[#e3e8ee] text-sm">
              <b className="text-[#102f59]"><LocalTime iso={session.startedAt.toISOString()} /></b>
              <span>{session.actorName}</span>
              <span className="text-[#697181]">{SOURCE_LABEL[session.source] ?? session.source}</span>
              <span className="text-[#8b929d]">{session.events.length} event{session.events.length === 1 ? "" : "s"}</span>
              <span className="ml-auto"><ExportButtons query="" session={session.key} compact /></span>
            </header>
            <ul className="divide-y divide-[#eef1f5]">
              {session.events.map(row => {
                const { label, tone } = rowLabel(row);
                const text = row.event === "heard" || row.event === "request" || row.event === "confirmation" ? row.utterance : "";
                const reply = row.spokenAnswer;
                return (
                  <li key={row.id} className="grid grid-cols-[88px_1fr] sm:grid-cols-[110px_190px_1fr] gap-x-4 gap-y-1 px-5 py-3 text-sm items-start">
                    <span className="text-xs text-[#8b929d] pt-0.5"><LocalTime iso={row.createdAt.toISOString()} /></span>
                    <span className={`justify-self-start px-2.5 py-1 rounded-full text-xs font-bold ${TONE[tone]} ${isChange(row) ? "ring-1 ring-[#25784b]/30" : ""}`}>{label}</span>
                    <div className="col-span-2 sm:col-span-1 min-w-0">
                      {text && <div className="text-[#202735]">“{text}”</div>}
                      {row.event === "request" && row.mode && <div className="text-xs text-[#8b929d]">understood as: {row.mode}{typeof row.detail.currentTaskId === "number" ? ` · on screen: Task #${row.detail.currentTaskId}` : ""}</div>}
                      {reply && <div className={text ? "mt-1 text-[#4a5160]" : "text-[#4a5160]"}>{row.event === "request" || row.event === "confirmation" ? "→ " : ""}{reply}</div>}
                      <Details row={row} />
                      {row.taskIds.length > 0 && <div className="mt-1 text-xs">{row.taskIds.map(id => <a key={id} href={`/?task=${id}`} className="mr-2 text-[#173f76] underline">Task #{id}</a>)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {sessions.length > shown.length && <p className="mt-4 text-sm text-[#697181]">Showing the newest {MAX_SESSIONS} of {sessions.length} sessions — narrow the period or filters to see older ones.</p>}
    </div>
  );
}
