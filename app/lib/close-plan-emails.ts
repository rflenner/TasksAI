// The emails Close Plan sends, in Task AI's email design (the frame and task cards of app/lib/email.ts). Pure (no database,
// no sending): they return { subject, html, text } so layout and wording are unit-tested (tests/close-plan-invitations.test.ts) and
// can be previewed at /email-preview. app/lib/close-plan-invitations.ts decides who gets one and sends it.
// Every email carries an unsubscribe link (see close-plan-notify-rules.ts): people can always ask not to be emailed.
import { emailShell, esc, taskCard } from "./email";

export type PlanEmailTask = { title: string; due?: string | null; overdue?: boolean; description?: string; status?: string };
export type Rendered = { subject: string; html: string; text: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// 2026-10-30 → 30 Oct 2026
export const niceDate = (d?: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d || undefined; };

// The header of every Close Plan email: the iSEEit logo (public/iseeit-logo.png, served by the app), then "Mutual Closeplan".
// If a mail program blocks images, the alt text "iSEEit" shows instead.
const header = () => `<img src="${(process.env.APP_URL || "https://tasks-ai.onrender.com").replace(/\/+$/, "")}/iseeit-logo.png" width="44" height="44" alt="iSEEit" style="display:inline-block;width:44px;height:44px;border-radius:8px;vertical-align:middle;border:0"> <span style="display:inline-block;margin-left:12px;font-size:20px;font-weight:700;color:#173f76;vertical-align:middle">Mutual Closeplan</span>`;

const eyebrow = (t: string) => `<div style="font-size:11px;letter-spacing:1.4px;font-weight:800;color:#173f76">${esc(t)}</div>`;
const heading = (t: string) => `<h1 style="margin:10px 0;color:#102f59;font-size:27px;line-height:1.25">${esc(t)}</h1>`;
const para = (html: string) => `<p style="color:#687384;font-size:15px;line-height:1.6;margin:10px 0 0">${html}</p>`;
const button = (url: string, label: string) => `<a href="${esc(url)}" style="display:inline-block;margin-top:26px;padding:14px 22px;border-radius:8px;background:#173f76;color:#fff;font-weight:700;text-decoration:none">${esc(label)}</a>`;
const small = (t: string) => `<p style="margin:26px 0 0;color:#9299a3;font-size:11px;line-height:1.6">${esc(t)}</p>`;
const section = (title: string) => `<h2 style="margin:28px 0 12px;color:#102f59;font-size:16px">${esc(title)}</h2>`;
const canBox = (items: string[]) => items.length ? `${section("What you can do")}<div style="background:#f5f8fc;border:1px solid #e3e8ee;border-radius:12px;padding:14px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items.map(c => `<tr><td width="20" valign="top" style="color:#25784b;font-weight:800;font-size:14px;padding:3px 0">✓</td><td style="color:#2b3445;font-size:14px;line-height:1.5;padding:3px 0">${esc(c)}</td></tr>`).join("")}</table></div>` : "";
const cards = (tasks: PlanEmailTask[], planTitle: string, url: string) => tasks.length
  ? `${section("Waiting for you")}<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${tasks.map(t => taskCard({ subject: t.title, description: t.description, project: planTitle, due: niceDate(t.due), overdue: t.overdue, status: t.status === "In progress" ? "In progress" : "Open", url })).join("")}</table>` : "";
const taskText = (tasks: PlanEmailTask[]) => tasks.length ? `\n\nWAITING FOR YOU\n${tasks.map(t => `- ${t.title}${t.overdue ? " (overdue)" : t.due ? ` (due ${niceDate(t.due)})` : ""}`).join("\n")}` : "";
const footer = (unsubscribeUrl: string) => `You are getting this because you are on a close plan. <a href="${esc(unsubscribeUrl)}" style="color:#697181">Stop these emails</a>.`;

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
  const introText = input.reminder
    ? `${input.fromName} from iSEEit invited you to the shared plan for ${input.planTitle}, and you haven't opened it yet. It takes a minute and needs no password.`
    : `${input.fromName} from iSEEit invited you to the shared plan for ${input.planTitle}. It shows every step to signature and go-live, who owns what, and when it's due.`;
  const html = emailShell(`${eyebrow(input.reminder ? "REMINDER" : "YOU’RE INVITED")}${heading(`Hello ${input.firstName}, ${input.reminder ? "your shared plan is waiting." : "your shared plan is ready."}`)}${para(esc(introText).replace(esc(input.planTitle), `<b>${esc(input.planTitle)}</b>`))}
${canBox(input.can)}${cards(shown, input.planTitle, input.url)}${more > 0 ? `<p style="margin:2px 0 0;color:#9299a3;font-size:12px">+${more} more in the plan.</p>` : ""}
${button(input.url, "Open the plan")}${small("This link is personal to you, so please don't forward it. No password needed. You'll get at most one email a week about this plan.")}`, footer(input.unsubscribeUrl), header());
  return {
    subject: input.reminder ? `Reminder: your ${input.planTitle} plan is waiting` : `${input.fromName} invited you to the ${input.planTitle} plan`,
    html,
    text: `Hello ${input.firstName},\n\n${introText}\n\nWHAT YOU CAN DO\n${input.can.map(c => `- ${c}`).join("\n")}${taskText(shown)}${more > 0 ? `\n+${more} more in the plan.` : ""}\n\nOpen the plan: ${input.url}\n\nThis link is personal to you, so please don't forward it. No password needed.\n\nStop these emails: ${input.unsubscribeUrl}`,
  };
}

export function renderAddedToPlan(input: { firstName: string; byName: string; planTitle: string; role?: string; url: string; unsubscribeUrl: string }): Rendered {
  const roleText = input.role ? ` as ${input.role}` : "";
  return {
    subject: `${input.byName} added you to the ${input.planTitle} close plan`,
    html: emailShell(`${eyebrow("ADDED TO A PLAN")}${heading(`Hello ${input.firstName}, you're on the ${input.planTitle} close plan.`)}${para(`${esc(input.byName)} added you${esc(roleText)}. You can see every task, who owns it and when it's due, and work on your own.`)}${button(input.url, "Open the close plan")}`, footer(input.unsubscribeUrl), header()),
    text: `Hello ${input.firstName},\n\n${input.byName} added you to the close plan ${input.planTitle}${roleText}. You can see every task, who owns it and when it's due, and work on your own.\n\nOpen the close plan: ${input.url}\n\nStop these emails: ${input.unsubscribeUrl}`,
  };
}
