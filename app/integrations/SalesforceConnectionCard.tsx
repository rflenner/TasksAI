"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SALESFORCE_DOMAIN, validateSalesforceDomain } from "../lib/salesforce-domain";

type SalesforceStatus = { domain: string; isConnected: boolean; tokenStatus: "active" | "expired" | null; connectedBy: string | null; connectedAt: string | null };

const connectedAtFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Sales AI's Connected Apps "Salesforce" card
// (pages/connectedApps/SalesforceConnectionCard.jsx + the handlers in
// pages/connectedApps/index.jsx), rebuilt in this app's plain CSS: logo,
// Connect/Disconnect, an "Expired" badge once Salesforce rejects the
// refresh token, and the custom-domain field — read-only while connected,
// saved on blur. Connect asks the server for the authorize URL and then
// navigates there; Salesforce sends the browser back through
// /api/integrations/salesforce/callback, which lands here with
// ?sfConnect=success|error.
export default function SalesforceConnectionCard({ onToast }: { onToast: (message: string) => void }) {
  const [status, setStatus] = useState<SalesforceStatus | null>(null);
  const [domain, setDomain] = useState(DEFAULT_SALESFORCE_DOMAIN);
  const [domainError, setDomainError] = useState("");
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);

  const applyStatus = (next: SalesforceStatus) => { setStatus(next); setDomain(next.domain); };

  const loadStatus = async () => {
    const response = await fetch("/api/integrations/salesforce");
    if (!response.ok) return;
    applyStatus(await response.json() as SalesforceStatus);
  };

  // One-time fetch-on-mount, plus reading (then clearing) the ?sfConnect
  // result the OAuth callback redirected back with.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate fetch-on-mount; loadStatus is reused after connect/disconnect, so it can't be inlined as an effect-local IIFE (same as IntegrationsClient's loadRuns).
    void loadStatus();
    const params = new URLSearchParams(window.location.search);
    const result = params.get("sfConnect");
    if (!result) return;
    onToast(result === "success" ? "Salesforce connected" : params.get("message") || "Salesforce connection failed");
    params.delete("sfConnect"); params.delete("message");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadStatus only closes over state setters.
  }, [onToast]);

  const isConnected = Boolean(status?.isConnected);
  const isTokenExpired = isConnected && status?.tokenStatus === "expired";

  const handleDomainChange = (value: string) => {
    const trimmed = value.trim();
    setDomain(trimmed);
    const { valid, error } = validateSalesforceDomain(trimmed);
    setDomainError(valid ? "" : error);
  };

  const handleDomainBlur = async () => {
    if (!validateSalesforceDomain(domain).valid || domain === status?.domain) return;
    const response = await fetch("/api/integrations/salesforce", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain }) });
    if (!response.ok) { setDomainError("Failed to update domain"); return; }
    applyStatus(await response.json() as SalesforceStatus);
  };

  const handleConnect = async () => {
    if (domainError || !domain) return;
    setBusy("connect");
    const response = await fetch("/api/integrations/salesforce/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain }) });
    const data = await response.json().catch(() => ({})) as { authorizeUrl?: string; error?: string };
    if (!response.ok || !data.authorizeUrl) {
      setBusy(null);
      onToast(data.error || "Unable to start Salesforce authentication");
      return;
    }
    window.location.href = data.authorizeUrl;
  };

  const handleDisconnect = async () => {
    setBusy("disconnect");
    const response = await fetch("/api/integrations/salesforce", { method: "DELETE", headers: { "content-type": "application/json" } });
    setBusy(null);
    if (!response.ok) { onToast("Disconnect error"); return; }
    applyStatus(await response.json() as SalesforceStatus);
  };

  const disabled = status === null || busy !== null || !!domainError || !domain;
  let buttonLabel = isConnected ? "Disconnect" : "Connect";
  if (busy === "connect") buttonLabel = "Connecting…";
  if (busy === "disconnect") buttonLabel = "Disconnecting…";

  return (
    <article className="crm-card">
      <div className="crm-card-head">
        <div className="crm-card-identity">
          <span className="crm-logo" aria-hidden="true">
            <svg viewBox="0 0 48 34" width="30" height="22"><path fill="#fff" d="M20 4.2a8.4 8.4 0 0 1 6.1-2.6c3.2 0 6 1.8 7.4 4.4a10.2 10.2 0 0 1 4.2-.9C43.4 5.1 48 9.7 48 15.4s-4.6 10.3-10.3 10.3c-.7 0-1.4-.1-2-.2a7.5 7.5 0 0 1-6.6 3.9c-1.2 0-2.3-.3-3.3-.8a8.6 8.6 0 0 1-16-.4c-.5.1-1 .2-1.6.2A8.2 8.2 0 0 1 0 20.2c0-3.1 1.7-5.8 4.2-7.2a9.4 9.4 0 0 1 15.8-8.8Z" /></svg>
          </span>
          <div>
            <b>Salesforce</b>
            <small>
              {isConnected && status?.connectedBy
                ? `Connected by ${status.connectedBy}${status.connectedAt ? ` on ${connectedAtFormat.format(new Date(status.connectedAt))}` : ""}.`
                : "Connect your Salesforce org to Task AI."}
            </small>
          </div>
        </div>
        <div className="crm-card-actions">
          {isTokenExpired && <span className="crm-badge expired" title="Salesforce access has expired. Reconnect to resume syncing.">Expired</span>}
          <button type="button" className={`crm-connect${isConnected ? " connected" : ""}`} disabled={disabled} onClick={() => void (isConnected ? handleDisconnect() : handleConnect())}>
            {busy && <span className="crm-spinner" aria-hidden="true" />}{buttonLabel}
          </button>
        </div>
      </div>
      <label className="crm-domain">
        <span>Salesforce Custom Domain</span>
        <div className={`crm-domain-input${domainError ? " invalid" : ""}${isConnected ? " readonly" : ""}`}>
          <span className="crm-domain-prefix">https://</span>
          <input
            value={domain}
            placeholder='Enter Salesforce custom domain (eg. use "mydomain.salesforce.com")'
            disabled={isConnected}
            aria-invalid={!!domainError}
            onChange={e => handleDomainChange(e.target.value)}
            onBlur={() => void handleDomainBlur()}
          />
        </div>
        {domainError && <small className="crm-domain-error">{domainError}</small>}
      </label>
    </article>
  );
}
