"use client";
import { useState } from "react";

// Copy / download for the voice audit trail. "Copy" fetches the same
// plain-text report the download button saves (app/api/voice-audit/
// export), so what's pasted into a chat is identical to the file. Falls
// back to opening the text in a new tab when the browser refuses
// clipboard access (clipboard needs a secure page and a user gesture).
export default function ExportButtons({ query, session, compact = false }: { query: string; session?: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle");
  const params = new URLSearchParams(query);
  if (session) params.set("session", session);
  const base = `/api/voice-audit/export?${params.toString()}`;

  async function copy() {
    setState("busy");
    try {
      const res = await fetch(base);
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
      window.open(base, "_blank");
      window.setTimeout(() => setState("idle"), 3000);
    }
  }

  const button = compact
    ? "px-2.5 py-1 rounded-md text-xs font-semibold border border-[#d7dce3] bg-white text-[#173f76] hover:bg-[#f2f4f7]"
    : "px-3 py-1.5 rounded-lg text-sm font-semibold border border-[#d7dce3] bg-white text-[#173f76] hover:bg-[#f2f4f7]";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void copy()} disabled={state === "busy"} className={button}>
        {state === "copied" ? "Copied ✓" : state === "failed" ? "Opened in a new tab" : state === "busy" ? "Copying…" : session ? "Copy session" : "Copy as text"}
      </button>
      <a href={`${base}&download=1`} className={button}>Download .txt</a>
      {!session && <a href={`${base}&format=json&download=1`} className={button}>JSON</a>}
    </span>
  );
}
