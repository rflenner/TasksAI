"use client";
import { useState } from "react";
import type { RoleDef, RoleSide, RoleUsage } from "../lib/close-plan-roles";

const box = "border border-[#e3e8ee] bg-white rounded-xl p-5 mb-4";
const btn = "border border-[#c9d3e0] rounded px-2 py-1 text-sm text-[#2b3445] disabled:opacity-30";
const SIDES: Array<{ side: RoleSide; title: string; hint: string }> = [
  { side: "buyer", title: "Customer roles", hint: "For the people at the customer." },
  { side: "seller", title: "iSEEit roles", hint: "For the iSEEit team on the plan." },
];

export default function CloseplanRolesClient({ initialRoles, initialUsage }: { initialRoles: RoleDef[]; initialUsage: RoleUsage }) {
  const [roles, setRoles] = useState<RoleDef[]>(initialRoles);
  const [saved, setSaved] = useState<RoleDef[]>(initialRoles);
  const [usage, setUsage] = useState<RoleUsage>(initialUsage);
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState(false);
  const dirty = JSON.stringify(roles) !== JSON.stringify(saved);

  const patch = (id: string, p: Partial<RoleDef>) => setRoles(rs => rs.map(r => r.id === id ? { ...r, ...p } : r));
  const move = (id: string, dir: -1 | 1) => setRoles(rs => {
    const side = rs.find(r => r.id === id)!.side, same = rs.filter(r => r.side === side), i = same.findIndex(r => r.id === id), j = i + dir;
    if (j < 0 || j >= same.length) return rs;
    const swapped = same.slice(); [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
    let k = 0; return rs.map(r => r.side === side ? swapped[k++] : r);
  });
  const add = (side: RoleSide) => setRoles(rs => [...rs, { id: `new-${Math.random().toString(36).slice(2, 8)}`, side, name: "" }]);
  const remove = (id: string) => setRoles(rs => rs.filter(r => r.id !== id));

  const used = (side: RoleSide, name: string) => usage[side][name]?.people || 0;
  const savedById = new Map(saved.map(r => [r.id, r]));
  const renames = roles.filter(r => savedById.has(r.id) && savedById.get(r.id)!.name !== r.name.trim()).map(r => ({ from: savedById.get(r.id)!, to: r.name.trim() }));
  const removed = saved.filter(r => !roles.some(x => x.id === r.id));
  const affectedRenames = renames.filter(x => used(x.from.side, x.from.name) > 0);
  const affectedRemoved = removed.filter(r => used(r.side, r.name) > 0);

  async function save() {
    setConfirming(false); setStatus("Saving…");
    const r = await fetch("/api/close-plans/roles", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ roles }) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) { setStatus(res.error || "Could not save"); return; }
    setRoles(res.roles); setSaved(res.roles); setUsage(res.usage);
    setStatus(res.people ? `Saved. ${res.people} ${res.people === 1 ? "person" : "people"} in ${res.plans} ${res.plans === 1 ? "plan" : "plans"} now have the new name.` : "Saved");
  }
  const onSave = () => (affectedRenames.length || affectedRemoved.length) ? setConfirming(true) : void save();

  return (
    <div>
      {SIDES.map(({ side, title, hint }) => {
        const list = roles.filter(r => r.side === side);
        return (
          <section key={side} className={box}>
            <h2 className="text-base font-bold text-[#102f59] mb-1">{title}</h2>
            <p className="text-sm text-[#697181] mb-3">{hint}</p>
            {list.map((r, i) => {
              const n = used(side, (savedById.get(r.id)?.name ?? r.name).trim());
              return (
                <div key={r.id} className="flex items-center gap-2 py-1.5">
                  <input aria-label="Role name" className="flex-1 border border-[#c9d3e0] rounded px-3 py-1.5 text-sm" value={r.name} maxLength={60} placeholder="Role name" onChange={e => patch(r.id, { name: e.target.value })} />
                  <span className="w-28 text-xs text-[#697181]">{n ? `${n} ${n === 1 ? "person" : "people"}` : "not used yet"}</span>
                  <span className="w-16 text-[11px] font-bold text-[#173f76]">{r.key ? "BUILT IN" : ""}</span>
                  <button className={btn} aria-label="Move up" disabled={i === 0} onClick={() => move(r.id, -1)}>↑</button>
                  <button className={btn} aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(r.id, 1)}>↓</button>
                  <button className={btn} aria-label="Remove role" disabled={!!r.key} title={r.key ? "Built-in roles can be renamed but not removed" : "Remove this role from the list"} onClick={() => remove(r.id)}>Remove</button>
                </div>
              );
            })}
            <button className={`${btn} mt-2`} onClick={() => add(side)}>+ Add a role</button>
          </section>
        );
      })}

      {confirming && (
        <section className="border border-[#f0c36d] bg-[#fff8e6] rounded-xl p-5 mb-4" role="alertdialog" aria-label="Confirm role changes">
          <h2 className="text-base font-bold text-[#102f59] mb-2">Check before saving</h2>
          <ul className="text-sm text-[#2b3445] list-disc pl-5 mb-3">
            {affectedRenames.map(x => <li key={x.from.id}>Everyone who is “{x.from.name}” ({used(x.from.side, x.from.name)}) becomes “{x.to}”, in every plan.</li>)}
            {affectedRemoved.map(r => <li key={r.id}>“{r.name}” leaves the list. The {used(r.side, r.name)} {used(r.side, r.name) === 1 ? "person who is" : "people who are"} “{r.name}” keep that role, but it is no longer offered.</li>)}
          </ul>
          <button className="bg-[#173f76] text-white rounded px-4 py-2 text-sm font-semibold mr-2" onClick={save}>Save changes</button>
          <button className={btn} onClick={() => setConfirming(false)}>Cancel</button>
        </section>
      )}

      <div className="flex items-center gap-3">
        <button className="bg-[#173f76] text-white rounded px-4 py-2 text-sm font-semibold disabled:opacity-40" disabled={!dirty} onClick={onSave}>Save roles</button>
        {dirty && <button className={btn} onClick={() => { setRoles(saved); setConfirming(false); setStatus(""); }}>Discard changes</button>}
        <span className="text-sm text-[#697181]" role="status">{status}</span>
      </div>
    </div>
  );
}
