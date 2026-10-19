// Re-applies a person's own changes on top of a newer version of a close plan (used by the page when a save is rejected because
// someone or something else, like the Salesforce sync, saved first). A three-way merge: `base` is the plan as the page last got
// it from the server, `local` is what the person has now, `server` is the newer version. What the person changed wins; what only
// the server changed (Salesforce sync fields, a colleague's edit of another task) is kept. Plain JS so the page and the tests
// (tests/close-plan-rebase.test.ts) share one file.
(function (root) {
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const isIdList = a => Array.isArray(a) && a.every(x => x && typeof x === "object" && typeof x.id === "string");

  // One task, phase or person: field by field.
  function mergeItem(local, base, server) {
    const out = clone(server || base || {});
    for (const k of new Set([...Object.keys(local), ...Object.keys(base || {})])) {
      if (same(local[k], (base || {})[k])) continue; // the person did not touch this field
      if (local[k] === undefined) delete out[k]; else out[k] = clone(local[k]);
    }
    return out;
  }

  // A list of things with ids (tasks, phases, people).
  function mergeList(local, base, server) {
    const bById = new Map(base.map(x => [x.id, x])), sById = new Map(server.map(x => [x.id, x])), lIds = new Set(local.map(x => x.id));
    const merged = new Map(server.map(x => [x.id, x]));
    for (const l of local) {
      const b = bById.get(l.id);
      if (!b) merged.set(l.id, clone(l)); // added by the person
      else if (!same(l, b)) merged.set(l.id, mergeItem(l, b, sById.get(l.id))); // changed by the person
    }
    for (const b of base) if (!lIds.has(b.id)) merged.delete(b.id); // deleted by the person
    const reordered = !same(base.map(x => x.id).filter(id => lIds.has(id)), local.map(x => x.id).filter(id => bById.has(id)));
    const order = reordered
      ? [...local.map(x => x.id), ...server.map(x => x.id).filter(id => !lIds.has(id))]
      : [...server.map(x => x.id), ...local.map(x => x.id).filter(id => !sById.has(id))];
    const seen = new Set();
    return order.filter(id => merged.has(id) && !seen.has(id) && seen.add(id)).map(id => merged.get(id));
  }

  function rebasePlan(local, base, server) {
    const out = clone(server);
    for (const key of new Set([...Object.keys(local), ...Object.keys(base)])) {
      const l = local[key], b = base[key];
      if (same(l, b)) continue; // the person did not change it: keep the server's
      if (key === "activity" && Array.isArray(l)) {
        const had = new Set((Array.isArray(b) ? b : []).map(x => JSON.stringify(x)));
        out.activity = [...l.filter(x => !had.has(JSON.stringify(x))).map(clone), ...(out.activity || [])].slice(0, 40);
      } else if (isIdList(l) && isIdList(b === undefined ? [] : b)) out[key] = mergeList(l, b || [], isIdList(out[key]) ? out[key] : []);
      else if (l === undefined) delete out[key];
      else out[key] = clone(l);
    }
    return out;
  }

  const api = { rebasePlan };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.rebasePlan = rebasePlan;
})(typeof window !== "undefined" ? window : globalThis);
