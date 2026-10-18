// The emails Close Plan sends. Pure (no database, no sending): they return { subject, html, text } so the layout and wording
// are unit-tested (tests/close-plan-emails.test.ts); app/lib/close-plan-invitations.ts decides who gets one and sends it.
// Every email carries an unsubscribe link (see close-plan-notify-rules.ts): people can always ask not to be emailed.

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export type PlanEmailTask = { title: string; due?: string | null; overdue?: boolean };
export type Rendered = { subject: string; html: string; text: string };

const shell = (inner: string, unsubscribeUrl: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" style="max-width:560px;background:#fff;border:1px solid #e3e8ee;border-radius:14px"><tr><td style="padding:26px 28px">
<div style="font-size:20px;font-weight:800;color:#173f76">Task <span style="background:#f0803c;color:#fff;border-radius:4px;padding:2px 5px;font-size:14px">AI</span> <span style="color:#173f76;font-weight:700">– Close Plan</span></div>
${inner}
</td></tr></table>
<p style="max-width:560px;color:#9299a3;font-size:12px;line-height:1.5;margin:14px 0 0">You are getting this because you are on a close plan. <a href="${esc(unsubscribeUrl)}" style="color:#697181">Stop these emails</a>.</p>
</td></tr></table></body></html>`;

const button = (url: string, label: string) => `<p style="margin:24px 0 6px"><a href="${esc(url)}" style="display:inline-block;background:#173f76;color:#fff;text-decoration:none;font-weight:700;border-radius:8px;padding:12px 22px">${esc(label)}</a></p>`;
const taskList = (tasks: PlanEmailTask[]) => tasks.length
  ? `<h3 style="margin:22px 0 8px;color:#102f59;font-size:15px">Waiting for you</h3><ul style="margin:0;padding-left:18px;color:#2b3445;font-size:14px;line-height:1.7">${tasks.map(t => `<li>${esc(t.title)}${t.overdue ? ` <b style="color:#b3402f">(overdue)</b>` : t.due ? ` <span style="color:#697181">(due ${esc(t.due)})</span>` : ""}</li>`).join("")}</ul>`
  : "";
const taskText = (tasks: PlanEmailTask[]) => tasks.length ? `\n\nWAITING FOR YOU\n${tasks.map(t => `- ${t.title}${t.overdue ? " (overdue)" : t.due ? ` (due ${t.due})` : ""}`).join("\n")}` : "";

// What a contact may do on the plan, from their access level.
export function accessSummary(access: { level?: string; create?: boolean } | undefined): string[] {
  const level = access?.level || "own";
  return [
    level === "view" ? "See the whole shared plan" : "See the whole shared plan and post updates on your tasks",
    level === "own" ? "Close and edit the tasks you own or work on" : level === "all" ? "Edit any task on the plan" : "",
    access?.create && level !== "view" ? "Add new tasks and subtasks" : "",
  ].filter(Boolean);
}

export function renderInvitation(input: { firstName: string; fromName: string; planTitle: string; url: string; unsubscribeUrl: string; can: string[]; tasks: PlanEmailTask[]; reminder?: boolean }): Rendered {
  const shown = input.tasks.slice(0, 4), more = input.tasks.length - shown.length;
  const intro = input.reminder
    ? `${esc(input.fromName)} from iSEEit invited you to the shared plan for <b>${esc(input.planTitle)}</b>, and you haven't opened it yet. It takes a minute and needs no password.`
    : `${esc(input.fromName)} from iSEEit invited you to the shared plan for <b>${esc(input.planTitle)}</b>. It shows every step to signature and go-live, who owns what, and when it's due.`;
  const introText = input.reminder
    ? `${input.fromName} from iSEEit invited you to the shared plan for ${input.planTitle}, and you haven't opened it yet. It takes a minute and needs no password.`
    : `${input.fromName} from iSEEit invited you to the shared plan for ${input.planTitle}. It shows every step to signature and go-live, who owns what, and when it's due.`;
  const html = shell(`<p style="color:#202735;font-size:15px;margin:22px 0 0">Hi ${esc(input.firstName)},</p>
<p style="color:#202735;font-size:14px;line-height:1.55;margin:8px 0 0">${intro}</p>
<h3 style="margin:22px 0 8px;color:#102f59;font-size:15px">What you can do</h3>
<ul style="margin:0;padding-left:18px;color:#4a5160;font-size:14px;line-height:1.7">${input.can.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
${taskList(shown)}${more > 0 ? `<p style="color:#9299a3;font-size:12px;margin:8px 0 0">+${more} more in the plan.</p>` : ""}
${button(input.url, "Open the plan")}
<p style="color:#697181;font-size:12.5px;line-height:1.5;margin:10px 0 0">This link is personal to you, so please don't forward it. No password needed. You'll get at most one email a week about this plan.</p>`, input.unsubscribeUrl);
  return {
    subject: input.reminder ? `Reminder: your ${input.planTitle} plan is waiting` : `${input.fromName} invited you to the ${input.planTitle} plan`,
    html,
    text: `Hi ${input.firstName},\n\n${introText}\n\nWHAT YOU CAN DO\n${input.can.map(c => `- ${c}`).join("\n")}${taskText(shown)}${more > 0 ? `\n+${more} more in the plan.` : ""}\n\nOpen the plan: ${input.url}\n\nThis link is personal to you, so please don't forward it. No password needed.\n\nStop these emails: ${input.unsubscribeUrl}`,
  };
}

export function renderAddedToPlan(input: { firstName: string; byName: string; planTitle: string; role?: string; url: string; unsubscribeUrl: string }): Rendered {
  const roleText = input.role ? ` as ${input.role}` : "";
  return {
    subject: `${input.byName} added you to the ${input.planTitle} close plan`,
    html: shell(`<p style="color:#202735;font-size:15px;margin:22px 0 0">Hi ${esc(input.firstName)},</p>
<p style="color:#202735;font-size:14px;line-height:1.55;margin:8px 0 0">${esc(input.byName)} added you to the close plan <b>${esc(input.planTitle)}</b>${esc(roleText)}. You can see every task, who owns it and when it's due, and work on your own.</p>${button(input.url, "Open the close plan")}`, input.unsubscribeUrl),
    text: `Hi ${input.firstName},\n\n${input.byName} added you to the close plan ${input.planTitle}${roleText}. You can see every task, who owns it and when it's due, and work on your own.\n\nOpen the close plan: ${input.url}\n\nStop these emails: ${input.unsubscribeUrl}`,
  };
}
