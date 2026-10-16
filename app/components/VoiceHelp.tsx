"use client";
import { useEffect, useState } from "react";
import type { Capability } from "../lib/voice-help";

// "What can I say?" for Task AI's voice assistants: the list from
// /api/voice-help (app/lib/voice-help.ts), loaded once when a panel opens.
// Lines with "…" are patterns to say; the others can be tapped to say them.
export function useVoiceCapabilities(open: boolean): Capability[] {
  const [caps, setCaps] = useState<Capability[]>([]);
  const loaded = caps.length > 0;
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    fetch("/api/voice-help").then(r => r.ok ? r.json() : null).then((d: { capabilities?: Capability[] } | null) => {
      if (!cancelled && d?.capabilities) setCaps(d.capabilities);
    }).catch(() => { /* help stays hidden */ });
    return () => { cancelled = true; };
  }, [open, loaded]);
  return caps;
}

export function VoiceHelpList({ caps, onPick }: { caps: Capability[]; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col">
      {caps.map(group => (
        <div key={group.group} className="mb-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#697181] mb-1">{group.group}</div>
          {group.items.map(item => item.includes("…") ? (
            <div key={item} className="text-[12px] italic text-[#697181] bg-[#fafbfc] border border-[#e3e8ee] rounded-md px-2 py-1 mb-1">“{item}”</div>
          ) : (
            <button key={item} type="button" onClick={() => onPick(item)} className="block w-full text-left text-[12px] text-[#202735] bg-white border border-[#e3e8ee] hover:border-[#c9dbf2] hover:bg-[#f7f9fc] rounded-md px-2 py-1 mb-1">“{item}”</button>
          ))}
        </div>
      ))}
    </div>
  );
}

// True only the first time this browser shows a given assistant's greeting.
export function firstTimeFor(key: string): boolean {
  try { const k = `voice-greeted:${key}`; const first = !localStorage.getItem(k); localStorage.setItem(k, "1"); return first; } catch { return false; }
}
