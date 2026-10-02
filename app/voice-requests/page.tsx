import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "../lib/session";
import { loadRankedRequests, STATUS_LABEL } from "../lib/voice-requests";
import LocalTime from "../voice-audit/LocalTime";
import StatusSelect from "./StatusSelect";

export const dynamic = "force-dynamic";

// What people asked the voice assistants for that they can't do yet, and
// their "I wish you could…" ideas, ranked by importance (see rankRequests:
// how many people asked weighs most, then wishes, asking again in the same
// session, and how often). Site admins only: it shows who asked and what they said.
const SURFACE: Record<string, string> = { close_plan: "Close plan", task_ai: "Task AI" };
const STATUS_TONE: Record<string, string> = { new: "text-[#173f76]", planned: "text-[#9b5d00]", built: "text-[#25784b]", wont_do: "text-[#8b929d]" };

export default async function VoiceRequestsPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?returnTo=/voice-requests");
  if (actor.role !== "site_admin") redirect("/");
  const requests = await loadRankedRequests();
  const open = requests.filter(r => r.status !== "built" && r.status !== "wont_do");

  return (
    <div className="max-w-5xl mx-auto p-8">
      <Link href="/" className="text-sm text-[#697181]">← Back to Task AI</Link>
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76] mt-4">VOICE</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-1 mb-1">Voice requests</h1>
      <p className="text-[#697181] mb-2 max-w-3xl">What people asked the voice assistant for that it can&apos;t do yet, and their &ldquo;I wish you could…&rdquo; ideas. Similar requests are grouped under one name. Ranked by importance: how many different people asked weighs most, then explicit wishes, asking again in the same session (usually rephrased after a failure), and how often overall.</p>
      <p className="text-sm text-[#697181] mb-6"><b className="text-[#173f76]">{open.length}</b> open request{open.length === 1 ? "" : "s"} · <Link href="/voice-audit" className="text-[#173f76] font-semibold">Voice audit trail →</Link></p>

      {!requests.length && <div className="border border-[#e3e8ee] bg-white rounded-lg p-6 text-[#697181]">No requests yet. When someone asks the voice assistant for something it can&apos;t do, or says &ldquo;I wish you could…&rdquo;, it shows up here.</div>}

      <ol className="space-y-3">
        {requests.map((r, i) => (
          <li key={r.name} className={`border border-[#e3e8ee] bg-white rounded-xl p-4 ${r.status === "built" || r.status === "wont_do" ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <span className="text-lg font-bold text-[#8b929d] w-7">{i + 1}</span>
              <div className="flex-1 min-w-[240px]">
                <h2 className="text-base font-bold text-[#102f59]">{r.name}</h2>
                <div className="text-xs text-[#697181] mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <span><b className="text-[#202735]">{r.people}</b> {r.people === 1 ? "person" : "people"}</span>
                  <span><b className="text-[#202735]">{r.times}</b> time{r.times === 1 ? "" : "s"}</span>
                  {r.wishes > 0 && <span><b className="text-[#202735]">{r.wishes}</b> wish{r.wishes === 1 ? "" : "es"}</span>}
                  {r.frustrated > 0 && <span className="text-[#a84235]">asked again {r.frustrated}× in one session</span>}
                  <span>last <LocalTime iso={r.lastAt.toISOString()} /></span>
                  <span>{r.surfaces.map(s => SURFACE[s] ?? s).join(", ")}</span>
                </div>
                <ul className="mt-2 text-sm text-[#4a5160] space-y-0.5">{r.examples.map(e => <li key={e}>“{e}”</li>)}</ul>
                <div className="text-xs text-[#8b929d] mt-1">Asked by {r.askedBy.join(", ")}</div>
              </div>
              <div className="text-right">
                <div className={`text-xs font-bold mb-1 ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</div>
                <StatusSelect name={r.name} status={r.status} note={r.note} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
