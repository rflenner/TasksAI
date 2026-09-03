export type DigestTask = {
  subject: string;
  description?: string;
  project?: string;
  topic?: string;
  meeting?: string;
  due?: string;
  role?: "Owner" | "Coworker" | "Recipient";
  status?: "Open" | "In progress" | "Completed";
  overdue?: boolean;
  url?: string;
  // Points at /update-task?token=... (app/lib/task-update-tokens.ts) — lets
  // someone leave a status update on this one task with no Task AI sign-in
  // at all. Optional and per-task (not per-email) since it's only ever set
  // when the caller has already minted a token for this exact recipient +
  // task; a task with no updateUrl just doesn't get the button.
  updateUrl?: string;
};

type DigestInput = {
  firstName: string;
  appUrl: string;
  open: number;
  overdue: number;
  completed: number;
  pending: DigestTask[];
  accomplished: DigestTask[];
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[character] || character));

// Secondary metadata, not a call-out — kept visually quiet next to the due/
// role/status row above it.
function tag(label: string, value?: string) {
  if (!value) return "";
  const icon = label === "Project" ? "▰" : label === "Meeting" ? "↻" : label === "Topic" ? "#" : "";
  return `<span style="display:inline-block;margin:0 5px 5px 0;padding:2px 6px;border:1px solid #e6ebf1;border-radius:999px;background:#f6f8fa;color:#8993a2;font-size:9.5px;line-height:1.3">${icon ? `${icon}&nbsp;` : ""}${esc(value)}</span>`;
}

// Mobile clients that honor the <style> media query (Apple Mail, Gmail app,
// Outlook mobile) swap to the pre-truncated span; everyone else — including
// Outlook desktop, which ignores @media entirely — just sees the full text.
function truncated(text: string, max = 80) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function taskCard(task: Omit<DigestTask, "status"> & { status?: DigestTask["status"] | "Closed"; closedAt?: string }) {
  const status = task.status || "Open";
  const closed = status === "Closed" || status === "Completed";
  const dueColor = closed ? "#25784b" : task.overdue ? "#c87300" : "#5c6b7d";
  const dueLabel = closed ? `Closed${task.closedAt ? ` · ${task.closedAt}` : ""}` : task.overdue ? `Overdue${task.due ? ` · ${task.due}` : ""}` : task.due ? `Due · ${task.due}` : "No due date";
  const statusBackground = closed ? "#e4f4eb" : status === "In progress" ? "#fff1d6" : "#f2f4f7";
  const statusColor = closed ? "#25784b" : status === "In progress" ? "#9b5d00" : "#202735";
  const description = task.description ? `<tr><td class="tai-desc" style="padding:10px 18px 0;font-size:13px;line-height:1.5;color:#6f7885">
    <span class="tai-desc-full">${esc(task.description)}</span><span class="tai-desc-short" style="display:none">${esc(truncated(task.description))}</span>
  </td></tr>` : "";
  const tags = `${tag("Project", task.project)}${tag("Topic", task.topic)}${tag("Meeting", task.meeting)}`;
  // The update-link button is a sibling of the <a>, not nested inside it —
  // email clients (and HTML in general) don't tolerate a link inside a
  // link, and the whole card above stays clickable to open Task AI as
  // before. The outer <div> (not the <a>) now owns the card's border/
  // radius/background/clipping, since it has to wrap both.
  const updateLink = task.updateUrl ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="tai-head" style="padding:0 18px 14px">
    <a href="${esc(task.updateUrl)}" style="display:inline-block;font-size:12px;font-weight:700;color:#173f76;text-decoration:none;border:1px solid #dfe5ec;border-radius:7px;padding:7px 12px">Add an update →</a>
  </td></tr></table>` : "";
  return `<tr><td style="padding:0 0 12px">
    <div style="overflow:hidden;border:1px solid #dfe5ec;border-radius:12px;background:#ffffff">
      <a href="${esc(task.url || "#")}" aria-label="View ${esc(task.subject)}" style="display:block;text-decoration:none;color:inherit">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr><td class="tai-head" style="padding:14px 18px;background:#eef3fa;border-radius:11px 11px 0 0">
            <div style="font-size:16px;line-height:1.35;font-weight:700;color:#173f76">${esc(task.subject)}</div>
          </td></tr>
          <tr><td class="tai-head" style="padding:10px 18px 0">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
              <td style="white-space:nowrap;font-size:11px;font-weight:700;color:${dueColor}">${esc(dueLabel)}</td>
              <td style="padding-left:10px;font-size:11px;color:#7a8492">${task.role ? `Role: ${esc(task.role)}` : ""}</td>
              <td align="right" style="white-space:nowrap"><span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${statusBackground};color:${statusColor};font-size:10.5px;font-weight:700">${esc(status)}</span></td>
            </tr></table>
          </td></tr>
          ${description}
          <tr><td class="tai-head" style="padding:12px 18px ${task.updateUrl ? "10px" : "14px"}">${tags}</td></tr>
        </table>
      </a>
      ${updateLink}
    </div>
  </td></tr>`;
}

export function renderTaskDigest(input: DigestInput) {
  const pending = input.pending.map(taskCard).join("");
  const accomplished = input.accomplished.map(taskCard).join("");
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Your Task AI summary</title></head>
  <body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#202735">
    <div style="display:none;max-height:0;overflow:hidden">${input.open} open action items, ${input.overdue} overdue. Your Task AI summary is ready.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fa"><tr><td align="center" style="padding:32px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px">
        <tr><td style="padding:0 4px 22px"><span style="font-size:30px;font-weight:800;color:#173f76">Task</span> <span style="display:inline-block;padding:5px 6px;border-radius:5px;background:#ffa614;color:#fff;font-size:20px;font-weight:800;vertical-align:4px">AI</span></td></tr>
        <tr><td style="padding:34px 34px 30px;border-radius:16px 16px 0 0;background:#173f76">
          <div style="color:#bcd0e8;font-size:12px;font-weight:700;letter-spacing:1.5px">YOUR TASK SUMMARY</div>
          <h1 style="margin:10px 0 8px;color:#fff;font-size:29px;line-height:1.25">Hello ${esc(input.firstName)}, here’s what needs your attention.</h1>
          <p style="margin:0;color:#dce7f4;font-size:15px;line-height:1.5">A clear view of your pending and recently accomplished action items.</p>
        </td></tr>
        <tr><td style="padding:24px 34px;background:#fff">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td width="33%" style="padding:14px;border:1px solid #e5eaf0;border-radius:10px"><div style="font-size:11px;color:#7a8492;font-weight:700">OPEN</div><div style="margin-top:4px;font-size:27px;color:#173f76;font-weight:800">${input.open}</div></td>
            <td width="3%"></td><td width="30%" style="padding:14px;border:1px solid #ffd797;border-top:3px solid #ffa614;border-radius:10px"><div style="font-size:11px;color:#7a8492;font-weight:700">OVERDUE</div><div style="margin-top:2px;font-size:27px;color:#c87300;font-weight:800">${input.overdue}</div></td>
            <td width="3%"></td><td width="31%" style="padding:14px;border:1px solid #e5eaf0;border-radius:10px"><div style="font-size:11px;color:#7a8492;font-weight:700">COMPLETED</div><div style="margin-top:4px;font-size:27px;color:#25784b;font-weight:800">${input.completed}</div></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:4px 34px 30px;background:#fff">
          <h2 style="margin:14px 0 15px;color:#102f59;font-size:19px">Needs attention</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${pending || `<tr><td style="padding:18px;background:#f5f8fb;border-radius:10px;color:#687384">You have no pending action items.</td></tr>`}</table>
          ${accomplished ? `<h2 style="margin:26px 0 15px;color:#102f59;font-size:19px">Recently accomplished</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${accomplished}</table>` : ""}
          <div style="text-align:center;padding:20px 0 4px"><a href="${esc(input.appUrl)}" style="display:inline-block;padding:14px 24px;border-radius:8px;background:#173f76;color:#fff;font-size:14px;font-weight:700;text-decoration:none">Open my Task AI workspace</a></div>
        </td></tr>
        <tr><td style="padding:22px 30px;border-top:1px solid #e5eaf0;border-radius:0 0 16px 16px;background:#fff;text-align:center;color:#8a94a2;font-size:11px;line-height:1.6">You received this update because you are an owner, coworker, or recipient in Task AI.<br>Notification preferences will be available in your profile.</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  const text = `Hello ${input.firstName},\n\nYour Task AI summary: ${input.open} open, ${input.overdue} overdue, ${input.completed} completed.\n\n${input.pending.map(task => `- ${task.subject} (${task.due || "no due date"})`).join("\n")}\n\nOpen Task AI: ${input.appUrl}`;
  return { subject: `${input.overdue ? `${input.overdue} overdue · ` : ""}Your Task AI summary`, html, text };
}

// Task cap for the invitation preview, deliberately smaller than the digest
// email's section caps (8) — this is a hook to get someone to register, not
// a full list; the rest is one click away once they're in.
const INVITE_TASK_CAP = 6;
export function renderInvitationEmail(input: { name?: string; inviteUrl: string; invitedBy?: string; tasks?: PendingTaskLine[] }) {
  const name = input.name && input.name !== "Invited user" ? input.name.split(" ")[0] : "there";
  const tasks = input.tasks || [];
  const shown = tasks.slice(0, INVITE_TASK_CAP);
  const more = tasks.length > shown.length ? tasks.length - shown.length : 0;
  const invitedByName = input.invitedBy || "Your team";
  // When we know of open items naming this person, lead with that instead
  // of the generic "join your team" pitch — the tasks are the reason
  // they'd want to register in the first place, not an afterthought.
  const introPlain = shown.length
    ? `${invitedByName} invited you to Task AI — you have ${tasks.length} open item${tasks.length === 1 ? "" : "s"} waiting below. Confirm your profile to view and manage them.`
    : `${invitedByName} invited you to confirm your profile and see the action items shared with you.`;
  const rows = shown.map(task => taskCard(task)).join("");
  const moreHtml = more ? `<p style="margin:8px 0 0;color:#9299a3;font-size:12px">+${more} more once you're in.</p>` : "";
  const tasksHtml = shown.length ? `<h2 style="margin:26px 0 12px;color:#102f59;font-size:16px">Waiting for you</h2><table role="presentation" width="100%" style="border-collapse:collapse">${rows}</table>${moreHtml}` : "";
  const tasksText = shown.length ? `\n\nWAITING FOR YOU\n${shown.map(task => `- ${task.subject}${task.overdue ? " (overdue)" : task.due ? ` (due ${task.due})` : ""}`).join("\n")}${more ? `\n+${more} more once you're in.` : ""}` : "";
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>
    @media screen and (max-width:480px){
      .tai-outer{padding:20px 8px !important}
      .tai-inner{padding:22px 16px !important}
      .tai-head{padding-left:14px !important;padding-right:14px !important}
      .tai-desc{padding-left:14px !important;padding-right:14px !important}
      .tai-desc-full{display:none !important}
      .tai-desc-short{display:inline !important}
    }
  </style></head><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td align="center" class="tai-outer" style="padding:40px 16px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px"><tr><td class="tai-inner" style="padding:28px 34px;border-bottom:1px solid #e7ebef"><span style="font-size:28px;font-weight:800;color:#173f76">Task</span> <span style="padding:5px 6px;border-radius:5px;background:#ffa614;color:#fff;font-size:18px;font-weight:800">AI</span></td></tr><tr><td class="tai-inner" style="padding:38px 34px"><div style="font-size:11px;letter-spacing:1.4px;font-weight:800;color:#173f76">YOU’RE INVITED</div><h1 style="margin:10px 0;color:#102f59;font-size:27px">Hello ${esc(name)}, join your team in Task AI.</h1><p style="color:#687384;font-size:15px;line-height:1.6">${esc(introPlain)}</p>${tasksHtml}<a href="${esc(input.inviteUrl)}" style="display:inline-block;margin-top:24px;padding:14px 22px;border-radius:8px;background:#173f76;color:#fff;font-weight:700;text-decoration:none">Confirm profile & view tasks</a><p style="margin-top:28px;color:#9299a3;font-size:11px">This secure invitation expires after seven days and can only be used once.</p></td></tr></table></td></tr></table></body></html>`;
  const subject = shown.length ? `You have ${tasks.length} open item${tasks.length === 1 ? "" : "s"} waiting in Task AI` : "You’re invited to Task AI";
  return { subject, html, text: `${introPlain}${tasksText}\n\nConfirm your profile and view your tasks: ${input.inviteUrl}` };
}

export type PendingTaskLine = { subject: string; description?: string; project?: string; topic?: string; meeting?: string; due?: string; overdue?: boolean; status?: "Open" | "In progress" | "Closed"; role?: "Owner" | "Coworker" | "Recipient"; closedAt?: string; url?: string; taskId?: number; updateUrl?: string };
// Each caller decides how many items to hand in per bucket (the manual
// "Send task summary" button sends everything; the daily cron pre-filters
// and caps); this just enforces a hard display ceiling so no single section
// can blow out an otherwise-short email, with a "+N more" note when capped.
const SECTION_CAP: Record<"myTasks" | "delegatedTasks" | "recentlyClosed" | "newTasks", number> = { myTasks: 8, delegatedTasks: 8, recentlyClosed: 5, newTasks: 10 };
function section(title: string, tasks: PendingTaskLine[], key: keyof typeof SECTION_CAP, linkUrl: string) {
  if (!tasks.length) return { html: "", text: "" };
  const cap = SECTION_CAP[key];
  const shown = tasks.slice(0, cap);
  const rows = shown.map(task => taskCard({ ...task, url: task.url || linkUrl })).join("");
  const more = tasks.length > shown.length ? `<p style="margin:8px 0 0;color:#9299a3;font-size:12px">+${tasks.length - shown.length} more in Task AI.</p>` : "";
  const html = `<h2 style="margin:24px 0 12px;color:#102f59;font-size:16px">${esc(title)}</h2><table role="presentation" width="100%" style="border-collapse:collapse">${rows}</table>${more}`;
  const text = `${title.toUpperCase()}\n${shown.map(task => `- ${task.subject}${task.status === "Closed" ? task.closedAt ? ` (closed ${task.closedAt})` : " (closed)" : task.overdue ? " (overdue)" : task.due ? ` (due ${task.due})` : ""}`).join("\n")}${more ? `\n+${tasks.length - shown.length} more in Task AI.` : ""}`;
  return { html, text };
}
export function renderPendingTasksEmail(input: { firstName: string; appUrl: string; myTasks: PendingTaskLine[]; delegatedTasks: PendingTaskLine[]; recentlyClosed: PendingTaskLine[]; overdueCount?: number }) {
  const firstName = input.firstName.split(" ")[0] || "there";
  const totalOpen = input.myTasks.length + input.delegatedTasks.length;
  const overdueCount = input.overdueCount ?? [...input.myTasks, ...input.delegatedTasks].filter(task => task.overdue).length;
  const overdueClause = overdueCount ? `, ${overdueCount} overdue` : "";
  const summaryParts = [
    input.myTasks.length ? `${input.myTasks.length} task${input.myTasks.length === 1 ? "" : "s"} of your own` : "",
    input.delegatedTasks.length ? `${input.delegatedTasks.length} delegated task${input.delegatedTasks.length === 1 ? "" : "s"} you're tracking` : "",
  ].filter(Boolean);
  const summary = summaryParts.length ? summaryParts.join(" and ") : "no open tasks right now";
  // Opens the app pre-filtered to the same personal, due-this-week-or-earlier
  // view shown below — not just the bare app root. Closed cards link to the
  // completed tab instead, since the reminder view excludes closed tasks.
  const openLinkUrl = `${input.appUrl}/?view=reminder`;
  const closedLinkUrl = `${input.appUrl}/?view=completed`;
  const myTasksSection = section("My tasks", input.myTasks, "myTasks", openLinkUrl);
  const delegatedSection = section("Delegated tasks", input.delegatedTasks, "delegatedTasks", openLinkUrl);
  const closedSection = section("Recently closed", input.recentlyClosed, "recentlyClosed", closedLinkUrl);
  const sectionsHtml = myTasksSection.html + delegatedSection.html + closedSection.html;
  const subject = totalOpen ? `You have ${totalOpen} pending task${totalOpen === 1 ? "" : "s"} in Task AI` : `${input.recentlyClosed.length} task${input.recentlyClosed.length === 1 ? "" : "s"} closed recently in Task AI`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>
    @media screen and (max-width:480px){
      .tai-outer{padding:20px 8px !important}
      .tai-inner{padding:22px 16px !important}
      .tai-head{padding-left:14px !important;padding-right:14px !important}
      .tai-desc{padding-left:14px !important;padding-right:14px !important}
      .tai-desc-full{display:none !important}
      .tai-desc-short{display:inline !important}
    }
  </style></head><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td align="center" class="tai-outer" style="padding:40px 16px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px"><tr><td class="tai-inner" style="padding:28px 34px;border-bottom:1px solid #e7ebef"><span style="font-size:28px;font-weight:800;color:#173f76;vertical-align:middle">Task</span> <span style="display:inline-block;padding:5px 6px;border-radius:5px;background:#ffa614;color:#fff;font-size:18px;font-weight:800;line-height:1;vertical-align:middle">AI</span> <span style="font-size:28px;font-weight:800;color:#173f76;vertical-align:middle">– Pending Tasks Update</span></td></tr><tr><td class="tai-inner" style="padding:38px 34px"><div style="color:#102f59;font-size:14px;font-weight:700">Hi ${esc(firstName)},</div><div style="margin-top:4px;color:#102f59;font-size:14px;font-weight:700">you have ${esc(summary)}${overdueClause}.</div><div style="margin-top:4px;color:#5b6577;font-size:13px">Please review below or open Task AI.</div>${sectionsHtml}<a href="${esc(openLinkUrl)}" style="display:inline-block;margin-top:24px;padding:14px 22px;border-radius:8px;background:#173f76;color:#fff;font-weight:700;text-decoration:none">Open Task AI</a></td></tr></table></td></tr></table></body></html>`;
  const text = `Hi ${firstName},\n\nyou have ${summary}${overdueClause}.\nPlease review below or open Task AI.\n\n${[myTasksSection.text, delegatedSection.text, closedSection.text].filter(Boolean).join("\n\n")}\n\nOpen Task AI: ${openLinkUrl}`;
  return { subject, html, text };
}

// Focused nudge for tasks the recipient specifically owns and are now
// overdue — separate from the broader weekly digest (renderPendingTasksEmail)
// on purpose: this is meant to read as urgent and owner-specific, not get
// lost among a week's worth of everything else on their plate.
export function renderOverdueNudgeEmail(input: { firstName: string; appUrl: string; overdueTasks: PendingTaskLine[] }) {
  const firstName = input.firstName.split(" ")[0] || "there";
  const count = input.overdueTasks.length;
  // Its own view param, distinct from the weekly digest's ?view=reminder:
  // that one lands on "everything due this week or earlier, any role",
  // which on click-through looked like "all my tasks" rather than the
  // owner-only overdue list this email actually promised. ?view=overdue
  // opens My tasks pre-filtered to Role=Owner, Status=Overdue — matching
  // this email's content exactly.
  const openLinkUrl = `${input.appUrl}/?view=overdue`;
  const overdueSection = section("Overdue — owned by you", input.overdueTasks, "myTasks", openLinkUrl);
  const subject = `⚠ ${count} overdue task${count === 1 ? "" : "s"} — action needed`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>
    @media screen and (max-width:480px){
      .tai-outer{padding:20px 8px !important}
      .tai-inner{padding:22px 16px !important}
      .tai-head{padding-left:14px !important;padding-right:14px !important}
      .tai-desc{padding-left:14px !important;padding-right:14px !important}
      .tai-desc-full{display:none !important}
      .tai-desc-short{display:inline !important}
    }
  </style></head><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td align="center" class="tai-outer" style="padding:40px 16px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px"><tr><td class="tai-inner" style="padding:28px 34px;border-bottom:1px solid #e7ebef"><span style="font-size:28px;font-weight:800;color:#173f76;vertical-align:middle">Task</span> <span style="display:inline-block;padding:5px 6px;border-radius:5px;background:#ffa614;color:#fff;font-size:18px;font-weight:800;line-height:1;vertical-align:middle">AI</span> <span style="font-size:28px;font-weight:800;color:#173f76;vertical-align:middle">– Overdue</span></td></tr><tr><td class="tai-inner" style="padding:38px 34px"><div style="color:#102f59;font-size:14px;font-weight:700">Hi ${esc(firstName)},</div><div style="margin-top:4px;color:#a84235;font-size:14px;font-weight:700">you own ${count} task${count === 1 ? "" : "s"} past due.</div><div style="margin-top:4px;color:#5b6577;font-size:13px">A quick update or a new due date keeps these off this list.</div>${overdueSection.html}<a href="${esc(openLinkUrl)}" style="display:inline-block;margin-top:24px;padding:14px 22px;border-radius:8px;background:#173f76;color:#fff;font-weight:700;text-decoration:none">Open Task AI</a></td></tr></table></td></tr></table></body></html>`;
  const text = `Hi ${firstName},\n\nyou own ${count} task${count === 1 ? "" : "s"} past due.\nA quick update or a new due date keeps these off this list.\n\n${overdueSection.text}\n\nOpen Task AI: ${openLinkUrl}`;
  return { subject, html, text };
}

// Daily nudge for tasks someone was just put on — as owner, coworker, or
// recipient — separate from both the weekly digest and the overdue nudge:
// this is about noticing a new assignment while it's fresh, not
// resurfacing something that's already been sitting on their plate. Reuses
// section()/taskCard() like every other digest, so a newly assigned task
// renders with the exact same due/role/status/description/tags — nothing
// new to learn.
export function renderNewTasksEmail(input: { firstName: string; appUrl: string; newTasks: PendingTaskLine[] }) {
  const firstName = input.firstName.split(" ")[0] || "there";
  const count = input.newTasks.length;
  const openLinkUrl = `${input.appUrl}/?view=reminder`;
  const newSection = section("New tasks assigned to you", input.newTasks, "newTasks", openLinkUrl);
  const subject = `${count} new task${count === 1 ? "" : "s"} assigned to you in Task AI`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>
    @media screen and (max-width:480px){
      .tai-outer{padding:20px 8px !important}
      .tai-inner{padding:22px 16px !important}
      .tai-head{padding-left:14px !important;padding-right:14px !important}
      .tai-desc{padding-left:14px !important;padding-right:14px !important}
      .tai-desc-full{display:none !important}
      .tai-desc-short{display:inline !important}
    }
  </style></head><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td align="center" class="tai-outer" style="padding:40px 16px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px"><tr><td class="tai-inner" style="padding:28px 34px;border-bottom:1px solid #e7ebef"><span style="font-size:28px;font-weight:800;color:#173f76;vertical-align:middle">Task</span> <span style="display:inline-block;padding:5px 6px;border-radius:5px;background:#ffa614;color:#fff;font-size:18px;font-weight:800;line-height:1;vertical-align:middle">AI</span> <span style="font-size:28px;font-weight:800;color:#173f76;vertical-align:middle">– New Assignments</span></td></tr><tr><td class="tai-inner" style="padding:38px 34px"><div style="color:#102f59;font-size:14px;font-weight:700">Hi ${esc(firstName)},</div><div style="margin-top:4px;color:#102f59;font-size:14px;font-weight:700">you have been assigned ${count} new task${count === 1 ? "" : "s"} in Task AI.</div><div style="margin-top:4px;color:#5b6577;font-size:13px">Please click on the tasks below to review them.</div>${newSection.html}<a href="${esc(openLinkUrl)}" style="display:inline-block;margin-top:24px;padding:14px 22px;border-radius:8px;background:#173f76;color:#fff;font-weight:700;text-decoration:none">Open Task AI</a></td></tr></table></td></tr></table></body></html>`;
  const text = `Hi ${firstName},\n\nYou have been assigned new tasks in Task AI, please click on the tasks to review them.\n\n${newSection.text}\n\nOpen Task AI: ${openLinkUrl}`;
  return { subject, html, text };
}

export function renderLoginEmail(input: { name: string; code: string; link: string }) {
  const firstName = input.name.split(" ")[0] || "there";
  // The link goes to a normal page (/login/confirm), never straight to an
  // API route — it requires an explicit click there before anything is
  // verified. That's what keeps this safe from both email link-scanners
  // (which prefetch links and would otherwise silently burn the code) and
  // the Chrome phishing heuristic a bare auto-redirecting `?token=` API
  // endpoint used to trigger. The typed code stays as a fallback for
  // signing in on a different device than the one the email was opened on.
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px"><tr><td style="padding:28px 34px;border-bottom:1px solid #e7ebef"><span style="font-size:28px;font-weight:800;color:#173f76">Task</span> <span style="padding:5px 6px;border-radius:5px;background:#ffa614;color:#fff;font-size:18px;font-weight:800">AI</span></td></tr><tr><td style="padding:38px 34px"><div style="font-size:11px;letter-spacing:1.4px;font-weight:800;color:#173f76">SECURE SIGN-IN</div><h1 style="margin:10px 0;color:#102f59;font-size:27px">Welcome back, ${esc(firstName)}.</h1><p style="color:#687384;font-size:15px;line-height:1.6">Click below to sign in to Task AI on this device.</p><a href="${esc(input.link)}" style="display:inline-block;margin-top:6px;padding:14px 22px;border-radius:8px;background:#173f76;color:#fff;font-weight:700;text-decoration:none">Sign in to Task AI</a><p style="margin-top:26px;color:#687384;font-size:13px;line-height:1.6">Signing in on a different device? Enter this code instead:</p><div style="margin-top:6px;padding:16px 22px;border-radius:8px;background:#f0f4fa;color:#173f76;font-size:30px;font-weight:800;letter-spacing:6px;text-align:center;font-family:'Courier New',monospace">${esc(input.code)}</div><p style="margin-top:28px;color:#9299a3;font-size:11px">This link and code expire in 15 minutes and can only be used once. If you did not request this, ignore this email.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: "Your Task AI sign-in link", html, text: `Sign in to Task AI: ${input.link}\n\nOn a different device? Use this code instead (expires in 15 minutes): ${input.code}` };
}

export async function sendWithResend(message: { to: string; cc?: string; subject: string; html: string; text: string; idempotencyKey?: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.TASK_AI_FROM_EMAIL || "Task AI <notifications@tasks.flenner.at>";
  if (!apiKey) return { sent: false, reason: "Resend is not configured; the secure link is ready for local testing." };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "TaskAI/0.1",
      ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: [message.to], ...(message.cc ? { cc: [message.cc] } : {}), subject: message.subject, html: message.html, text: message.text, tags: [{ name: "app", value: "task-ai" }] }),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.message || "Resend could not send the email"));
  return { sent: true, id: result.id };
}
