"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

type Passkey = { id: number; deviceLabel: string | null; createdAt: string; lastUsedAt: string | null };

function formatDate(value: string | null) {
  if (!value) return "Never used";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function AccountClient({ initialPasskeys }: { initialPasskeys: Passkey[] }) {
  const [passkeys, setPasskeys] = useState<Passkey[]>(initialPasskeys);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  // null until checked client-side after mount — same reasoning as
  // /login's supportsPasskeys: a browser-capability check the server has
  // no way to know, so rendering it straight in the body would hydration-
  // mismatch. Staying null (rather than defaulting false) avoids briefly
  // showing the "not supported" warning on browsers that actually do.
  const [supportsPasskeys, setSupportsPasskeys] = useState<boolean | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate one-time browser-capability read after mount, not a state sync; see the comment above.
  useEffect(() => { setSupportsPasskeys(browserSupportsWebAuthn()); }, []);

  // Only ever called from event handlers (after add/remove), never on
  // mount — the initial list comes from the server via initialPasskeys,
  // same reasoning as /login's error param: no effect-driven setState,
  // no hydration mismatch.
  const refresh = async () => {
    const res = await fetch("/api/auth/passkey/list");
    if (res.ok) setPasskeys((await res.json() as { passkeys: Passkey[] }).passkeys);
  };

  async function addPasskey() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const optionsRes = await fetch("/api/auth/passkey/register-options", { method: "POST" });
      const optionsJSON = await optionsRes.json() as PublicKeyCredentialCreationOptionsJSON & { error?: string };
      if (!optionsRes.ok) { setError(optionsJSON.error || "Could not start passkey setup"); setBusy(false); return; }
      const response = await startRegistration({ optionsJSON });
      const verifyRes = await fetch("/api/auth/passkey/register-verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response, deviceLabel: label.trim() }) });
      if (!verifyRes.ok) { const data = await verifyRes.json().catch(() => ({})) as { error?: string }; setError(data.error || "Could not save that passkey"); setBusy(false); return; }
      setLabel("");
      await refresh();
    } catch (err) {
      setError(err instanceof DOMException && err.name === "NotAllowedError" ? "Cancelled — nothing was added." : "Could not set up a passkey on this device.");
    }
    setBusy(false);
  }

  async function removePasskey(id: number) {
    if (!window.confirm("Remove this passkey? You'll need another way to sign in on that device afterward.")) return;
    const res = await fetch(`/api/auth/passkey/${id}`, { method: "DELETE" });
    if (res.ok) void refresh();
  }

  return (
    <div className="max-w-xl mx-auto p-8">
      <Link href="/" className="text-[13px] font-bold text-[#697181] mb-6 inline-block">← Back to Task AI</Link>
      <div className="text-[11px] font-extrabold tracking-widest text-[#173f76]">ACCOUNT</div>
      <h1 className="text-2xl font-bold text-[#102f59] mt-2 mb-1">Passkeys</h1>
      <p className="text-[#697181] mb-6">Sign in with Face ID, Touch ID, Windows Hello, or a security key — no email step. Add one per device you use.</p>

      {supportsPasskeys === false && (
        <div className="border border-[#e2a39c] bg-[#fdf1ef] text-[#a84235] rounded-lg p-4 text-sm mb-6">This browser doesn&apos;t support passkeys — try a recent Chrome, Safari, or Edge.</div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Name this device (optional)" className="flex-1 h-11 border border-[#d9dee5] rounded-lg px-3 text-sm outline-none focus:border-[#7898be]" />
        <button onClick={() => void addPasskey()} disabled={busy || !supportsPasskeys} className="h-11 px-5 rounded-lg font-bold text-white bg-[#173f76] disabled:opacity-50 whitespace-nowrap">
          {busy ? "Setting up…" : "+ Add a passkey"}
        </button>
      </div>

      {error && <div className="border border-[#e2a39c] bg-[#fdf1ef] text-[#a84235] rounded-lg p-4 text-sm mb-6">{error}</div>}

      <div className="text-[10px] font-bold uppercase tracking-wide text-[#8b929d] mb-2">Registered devices</div>
      {passkeys.length === 0 ? (
        <p className="text-sm text-[#9299a3]">No passkeys yet — add one above.</p>
      ) : (
        <div className="grid gap-2">
          {passkeys.map(pk => (
            <div key={pk.id} className="flex items-center justify-between border border-[#e3e8ee] bg-white rounded-lg p-4">
              <div>
                <div className="font-bold text-[#202735]">{pk.deviceLabel || "Unnamed device"}</div>
                <div className="text-xs text-[#9299a3] mt-1">Added {formatDate(pk.createdAt)} · Last used: {formatDate(pk.lastUsedAt)}</div>
              </div>
              <button onClick={() => void removePasskey(pk.id)} className="text-sm font-bold text-[#a84235]">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
