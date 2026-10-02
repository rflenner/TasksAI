"use client";
import { useState } from "react";

const OPTIONS: Array<[string, string]> = [["new", "New"], ["planned", "Planned"], ["built", "Built"], ["wont_do", "Won't do"]];

// The team's decision on a request: saved straight away, with an optional note.
export default function StatusSelect({ name, status, note }: { name: string; status: string; note: string }) {
  const [value, setValue] = useState(status);
  const [text, setText] = useState(note);
  const [state, setState] = useState<"" | "saving" | "saved" | "failed">("");
  async function save(next: string, nextNote: string) {
    setState("saving");
    const res = await fetch("/api/voice-requests", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, status: next, note: nextNote }) }).catch(() => null);
    setState(res && res.ok ? "saved" : "failed");
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <select aria-label={`Status of ${name}`} value={value} onChange={e => { setValue(e.target.value); void save(e.target.value, text); }} className="border border-[#d7dce3] rounded-md px-2 py-1 text-sm bg-white">
        {OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input aria-label={`Note on ${name}`} value={text} placeholder="Note" onChange={e => setText(e.target.value)} onBlur={() => { if (text !== note) void save(value, text); }} className="border border-[#d7dce3] rounded-md px-2 py-1 text-xs w-44" />
      <span className="text-[11px] text-[#8b929d] h-3">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "failed" ? "Not saved" : ""}</span>
    </div>
  );
}
