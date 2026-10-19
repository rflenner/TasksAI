// Demo content for a close plan: roles for the people on it (from their job titles, then a sensible default per position) and a
// handful of realistic tasks per person, spread over the plan's phases, with a mix of closed, in progress, open and one overdue
// task, a few status updates and a milestone: what a screenshot or a customer video needs. Pure and deterministic (no randomness)
// so it is unit-tested (tests/close-plan-demo-content.test.ts); the page (Plan options → Fill with demo content) applies the result.
// Plain JS so the page and the tests share one file.
(function (root) {
  const BUYER_ROLES = ["Executive sponsor", "Project lead", "Technical lead", "IT security", "Procurement", "Legal", "End-user representative"];
  const SELLER_ROLES = ["Account lead", "Solutions engineer", "Customer success", "Project manager"];
  // Job title → role, most specific first (the same patterns the new-plan guide uses).
  const BY_TITLE = [
    [/security/i, "IT security"], [/procurement|purchas|buyer/i, "Procurement"], [/legal|counsel|privacy/i, "Legal"],
    [/chief|\bc[eotcr]o\b|vice president|\bvp\b|head of|director/i, "Executive sponsor"], [/\bit\b|technical|architect|engineer|developer/i, "Technical lead"],
    [/\blead\b|enablement|project|program|product owner/i, "Project lead"], [/associate|representative|\brep\b|user/i, "End-user representative"],
  ];

  // [title, description, where in the plan (0 = first phase … 1 = last), internal only, milestone]
  const CATALOG = {
    "Executive sponsor": [["Approve the business case", "Review the proof of concept results and approve the business case for the next step.", 0.45, false, false], ["Sign the agreement", "Sign the agreement once legal and procurement are done.", 1, false, true]],
    "Project lead": [["Confirm the top three use cases", "Agree the use cases the rollout is measured against.", 0.08, false, false], ["Organize the pilot participants", "Pick the people from two regions who join the pilot.", 0.3, false, false], ["Plan the go-live training", "Book the training sessions for admins and users.", 0.85, false, false]],
    "Technical lead": [["Share the system landscape", "Send an overview of the systems the solution has to connect to.", 0.15, false, false], ["Provision the first users", "Set up sign-in and create the first user accounts.", 0.8, false, false]],
    "IT security": [["Complete the security questionnaire", "Answer the security questionnaire and share the certifications.", 0.35, false, false], ["Review the data processing terms", "Check the data processing agreement against the security policy.", 0.55, false, false]],
    "Procurement": [["Register iSEEit as a vendor", "Create the vendor record so a purchase order can be raised.", 0.6, false, false], ["Raise the purchase order", "Raise the purchase order for the agreed scope.", 0.85, false, false]],
    "Legal": [["Review the agreement", "Legal review of the agreement and the data processing terms.", 0.7, false, false], ["Confirm the data privacy terms", "Confirm where data is stored and who can access it.", 0.6, false, false]],
    "End-user representative": [["Test the daily workflow", "Try the solution on a normal working day and note what is missing.", 0.4, false, false], ["Give feedback after week one", "Share what works and what does not after the first week.", 0.95, false, false]],
    "Account lead": [["Prepare the executive summary", "A one-page summary of goals, scope and value for the sponsor.", 0.2, true, false], ["Send the commercial proposal", "Pricing and terms for the agreed scope.", 0.55, false, false]],
    "Solutions engineer": [["Prepare the demo environment", "Set up a demo environment with the customer's use cases.", 0.1, false, false], ["Run the technical walkthrough", "Walk the technical team through the architecture and the integrations.", 0.3, false, false]],
    "Customer success": [["Plan the onboarding kickoff", "Agree the onboarding plan and the first training dates.", 0.8, false, false], ["Set up the adoption dashboard", "Track usage against the agreed adoption targets.", 0.9, true, false]],
    "Project manager": [["Keep the plan current", "Review the plan every Monday and update owners and dates.", 0.2, true, false], ["Weekly status call", "Short call with both teams to clear blockers.", 0.5, false, false]],
  };
  const FALLBACK = [["Review the plan and confirm your tasks", "Read through the plan and tell us what is missing.", 0.1, false, false]];

  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);

  // A role for everybody: kept if they have one and `replace` is off, else from the job title, else the next unused default for their side.
  function suggestedRoles(people, replace) {
    const used = new Set(people.filter(p => p.role && !replace).map(p => p.role)), out = [];
    for (const side of ["buyer", "seller"]) {
      const pool = (side === "buyer" ? BUYER_ROLES : SELLER_ROLES).filter(r => !used.has(r));
      for (const p of people.filter(x => x.side === side)) {
        if (p.role && !replace) { out.push({ id: p.id, role: p.role, kept: true }); continue; }
        let role = side === "buyer" ? (BY_TITLE.find(([re]) => re.test(p.title || "")) || [])[1] : "";
        if (role && used.has(role)) role = "";
        if (!role) role = pool.find(r => !used.has(r)) || (side === "buyer" ? "Stakeholder" : "Team member");
        used.add(role); out.push({ id: p.id, role, kept: false });
      }
    }
    return out;
  }

  // Tasks for everyone: `newId()` makes ids, `today` is a date (so the result can be tested).
  function planDemoContent(input) {
    const { people, phases, tasks, today, newId, replace } = input;
    const roles = suggestedRoles(people, replace), roleOf = id => (roles.find(r => r.id === id) || {}).role || "";
    const seller = (input.sellerOwner && people.find(p => p.id === input.sellerOwner)) || people.find(p => p.side === "seller");
    const sponsor = people.find(p => roleOf(p.id) === "Executive sponsor") || people.find(p => p.side === "buyer");
    const have = new Set(tasks.map(t => t.title));
    const out = [], n = phases.length;
    people.forEach((p, pi) => {
      const items = CATALOG[roleOf(p.id)] || FALLBACK;
      const mates = people.filter(x => x.side === p.side && x.id !== p.id);
      items.forEach(([title, desc, at, internal, milestone], ti) => {
        if (have.has(title)) return;
        // Which phase and how far into it: at 1 the last phase near its end, otherwise at × phases picks the phase and the remainder the day.
        const idx = at >= 1 ? n - 1 : Math.floor(at * n), phase = phases[idx], inPhase = at >= 1 ? 0.9 : Math.min(0.9, Math.max(0.1, at * n - idx));
        const span = Math.max(1, daysBetween(phase.start || today, phase.end || phase.start || today));
        const due = addDays(phase.start || today, Math.round(span * inPhase));
        const counterpart = p.side === "buyer" ? (seller && seller.id) : (!internal && sponsor ? sponsor.id : null);
        out.push({ person: p.id, role: roleOf(p.id), title, desc, due, phase: phase.id, internal, milestone, ti, pi,
          coworkers: mates.length ? [mates[(pi + ti) % mates.length].id] : [], recipients: counterpart && counterpart !== p.id ? [counterpart] : [] });
      });
    });
    // Status by date: past → closed, except one open (the overdue one for screenshots); the next days → in progress; the rest open.
    const past = out.filter(t => t.due < today).sort((a, b) => a.due.localeCompare(b.due));
    const overdue = past.length > 2 ? past[Math.floor(past.length / 2)] : null;
    const result = out.map(t => {
      let status = "Open";
      if (t.due < today) status = t === overdue ? "Open" : "Closed";
      else if (t.due <= addDays(today, 10)) status = "In progress";
      const updates = status === "Closed" ? [{ by: t.person, at: addDays(t.due, -1), text: "Done. The details are in the shared folder." }]
        : status === "In progress" ? [{ by: t.person, at: addDays(today, -1), text: "Started. A first draft is ready for review." }] : [];
      return { id: newId(), phase: t.phase, parent: null, title: t.title, desc: t.desc, owner: t.person, coworkers: t.coworkers, recipients: t.recipients, due: t.due,
        status, shared: !t.internal, milestone: t.milestone, createdBy: seller ? seller.id : t.person, updates, ...(status === "Closed" ? { closedAt: t.due } : {}) };
    });
    return { roles, tasks: result };
  }

  const api = { planDemoContent, suggestedRoles };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.closePlanDemoContent = api;
})(typeof window !== "undefined" ? window : globalThis);
