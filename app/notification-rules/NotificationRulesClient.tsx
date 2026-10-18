"use client";
import { useState } from "react";
import type { NotificationRules } from "../lib/close-plan-notify-rules";

type Optout = { email: string; source: string; reason: string | null; createdAt: string };

const box = "border border-[#e3e8ee] bg-white rounded-xl p-5 mb-4";
const h2 = "text-base font-bold text-[#102f59] mb-1";
const hint = "text-sm text-[#697181] mb-3";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-3 py-1.5 text-sm text-[#2b3445]"><input type="checkbox" className="h-4 w-4" checked={checked} onChange={e => onChange(e.target.checked)} />{label}</label>;
}
function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return <label className="flex items-center gap-3 py-1.5 text-sm text-[#2b3445]"><input type="number" className="w-16 border border-[#c9d3e0] rounded px-2 py-1" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} />{label}</label>;
}

export default function NotificationRulesClient({ initial, initialOptouts }: { initial: NotificationRules; initialOptouts: Optout[] }) {
  const [rules, setRules] = useState<NotificationRules>(initial);
  const [saved, setSaved] = useState<NotificationRules>(initial);
  const [status, setStatus] = useState("");
  const [optouts, setOptouts] = useState<Optout[]>(initialOptouts);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const dirty = JSON.stringify(rules) !== JSON.stringify(saved);

  const loadOptouts = async () => { const r = await fetch("/api/close-plans/notification-optouts", { credentials: "same-origin" }); if (r.ok) setOptouts((await r.json()).optouts); };

  const set = <K extends keyof NotificationRules>(key: K, patch: Partial<NotificationRules[K]> | NotificationRules[K]) =>
    setRules(r => ({ ...r, [key]: typeof r[key] === "object" ? { ...(r[key] as object), ...(patch as object) } : patch }) as NotificationRules);

  async function save() {
    setStatus("Saving…");
    const r = await fetch("/api/close-plans/notification-rules", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules }) });
    const res = await r.json().catch(() => ({}));
    if (r.ok) { setRules(res.rules); setSaved(res.rules); setStatus("Saved"); } else setStatus(res.error || "Could not save");
  }
  async function exclude() {
    setError("");
    const r = await fetch("/api/close-plans/notification-optouts", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, reason }) });
    const res = await r.json().catch(() => ({}));
    if (r.ok) { setEmail(""); setReason(""); void loadOptouts(); } else setError(res.error || "Could not add");
  }
  async function include(e: string) {
    await fetch("/api/close-plans/notification-optouts", { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: e }) });
    void loadOptouts();
  }

  return (
    <div>
      <section className={box}>
        <h2 className={h2}>Invitations</h2>
        <p className={hint}>“Send invitation” on a customer contact emails them their personal link.</p>
        <Toggle label="Email the personal link when an invitation is sent" checked={rules.invitation.email} onChange={v => set("invitation", { email: v })} />
        <Num label="days until a reminder if they haven't opened it (0 = no reminder)" value={rules.invitation.reminderAfterDays} min={0} max={30} onChange={v => set("invitation", { reminderAfterDays: v })} />
        <Num label="reminders at most" value={rules.invitation.maxReminders} min={0} max={5} onChange={v => set("invitation", { maxReminders: v })} />
      </section>

      <section className={box}>
        <h2 className={h2}>Added to a plan (iSEEit team)</h2>
        <Toggle label="Email them" checked={rules.addedToPlan.internalEmail} onChange={v => set("addedToPlan", { internalEmail: v })} />
        <Toggle label="Slack message" checked={rules.addedToPlan.internalSlack} onChange={v => set("addedToPlan", { internalSlack: v })} />
      </section>

      <section className={box}>
        <h2 className={h2}>Assigned tasks (owner or coworker)</h2>
        <Toggle label="Email iSEEit people when a task is assigned to them" checked={rules.assignment.internalEmail} onChange={v => set("assignment", { internalEmail: v })} />
        <Toggle label="Slack message to iSEEit people" checked={rules.assignment.internalSlack} onChange={v => set("assignment", { internalSlack: v })} />
        <Toggle label="Email customer contacts when a task is assigned to them" checked={rules.assignment.customerEmail} onChange={v => set("assignment", { customerEmail: v })} />
      </section>

      <section className={box}>
        <h2 className={h2}>Pending and overdue</h2>
        <Toggle label="Overdue reminders to iSEEit task owners" checked={rules.overdue.internalReminders} onChange={v => set("overdue", { internalReminders: v })} />
        <Num label="days between reminders" value={rules.overdue.internalEveryDays} min={1} max={14} onChange={v => set("overdue", { internalEveryDays: v })} />
        <Toggle label="Customers see their overdue tasks in the Monday email (no separate reminders)" checked={rules.overdue.customersInMondayDigest} onChange={v => set("overdue", { customersInMondayDigest: v })} />
      </section>

      <section className={box}>
        <h2 className={h2}>Monday email</h2>
        <Toggle label="Send the Monday email" checked={rules.digest.monday} onChange={v => set("digest", { monday: v })} />
        <Toggle label="Plan owners get the plan overview and their tasks" checked={rules.digest.planOwners} onChange={v => set("digest", { planOwners: v })} />
        <Toggle label="Customer contacts get “My tasks” and “Requested by you”" checked={rules.digest.customers} onChange={v => set("digest", { customers: v })} />
        <Toggle label="Skip a week in which nothing is open for someone" checked={rules.digest.skipWhenNothingOpen} onChange={v => set("digest", { skipWhenNothingOpen: v })} />
      </section>

      <section className={box}>
        <h2 className={h2}>Tasks someone requested (Requested by)</h2>
        <Toggle label="iSEEit people hear about updates and closes as they happen" checked={rules.requestedBy.internalRealtime} onChange={v => set("requestedBy", { internalRealtime: v })} />
        <Toggle label="Customers hear about them in the Monday email" checked={rules.requestedBy.customersInDigest} onChange={v => set("requestedBy", { customersInDigest: v })} />
      </section>

      <section className={box}>
        <h2 className={h2}>Updates</h2>
        <Toggle label="Slack message to iSEEit people on updates and closes" checked={rules.updates.internalSlack} onChange={v => set("updates", { internalSlack: v })} />
        <Toggle label="Changes that arrive from Salesforce notify like any other change" checked={rules.updates.fromSalesforce} onChange={v => set("updates", { fromSalesforce: v })} />
      </section>

      <section className={box}>
        <h2 className={h2}>Never spam the client</h2>
        <Num label="scheduled emails per customer per plan per week, at most" value={rules.customerEmailCapPerWeek} min={1} max={7} onChange={v => set("customerEmailCapPerWeek", v)} />
      </section>

      <div className="flex items-center gap-3 mb-8">
        <button type="button" onClick={save} disabled={!dirty} className="bg-[#173f76] text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-40">Save rules</button>
        <span className="text-sm text-[#697181]">{dirty ? "Unsaved changes" : status}</span>
      </div>

      <section className={box}>
        <h2 className={h2}>Excluded from Close Plan emails</h2>
        <p className={hint}>People who asked not to be emailed. They are skipped whatever the rules say. Every Close Plan email also has an unsubscribe link that adds the person here.</p>
        <div className="flex flex-wrap gap-2 mb-2">
          <input className="border border-[#c9d3e0] rounded px-3 py-1.5 text-sm w-64" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email address" />
          <input className="border border-[#c9d3e0] rounded px-3 py-1.5 text-sm w-64" placeholder="Why (optional)" value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason" />
          <button type="button" onClick={exclude} disabled={!email.trim()} className="border border-[#173f76] text-[#173f76] text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40">Exclude</button>
        </div>
        {error && <p className="text-sm text-[#a8402f] mb-2">{error}</p>}
        {optouts.length === 0 ? <p className="text-sm text-[#697181]">Nobody is excluded.</p> : (
          <ul className="divide-y divide-[#eef1f5]">
            {optouts.map(o => (
              <li key={o.email} className="py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <b className="text-[#102f59]">{o.email}</b>
                <span className="text-[#697181]">{o.source === "self" ? "unsubscribed" : o.source === "plan" ? "marked on a plan" : "added by an admin"} · {new Date(o.createdAt).toLocaleDateString("en-GB")}{o.reason ? ` · ${o.reason}` : ""}</span>
                <button type="button" onClick={() => include(o.email)} className="ml-auto text-[#173f76] font-semibold">Include again</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
