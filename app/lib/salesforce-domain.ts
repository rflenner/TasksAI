// Kept apart from app/lib/salesforce.ts (node:crypto + the database) so
// the client-side Salesforce card can import it too — the browser and the
// server routes validate the domain with the exact same rules.

export const DEFAULT_SALESFORCE_DOMAIN = "login.salesforce.com";

// The token exchange POSTs the client secret to this domain, so it has to
// be a host Salesforce owns — never whatever an admin happens to type.
const ALLOWED_DOMAIN_SUFFIXES = ["salesforce.com", "force.com", "cloudforce.com", "salesforce.mil"];

export function isSalesforceHost(host: string) {
  const lowered = host.toLowerCase();
  return ALLOWED_DOMAIN_SUFFIXES.some(suffix => lowered === suffix || lowered.endsWith(`.${suffix}`));
}

// Same messages as Sales AI's validateSalesforceDomain
// (pages/connectedApps/connectedApps.utils.jsx) so the card reads
// identically, plus the Salesforce-host check above.
export function validateSalesforceDomain(value: string): { valid: boolean; error: string } {
  if (!value) return { valid: false, error: "Enter a valid Salesforce domain (eg. \"mydomain.salesforce.com\")" };
  if (/^https?:\/\//i.test(value)) return { valid: false, error: "Do not include http or https (eg. \"mydomain.salesforce.com\")" };
  if (value.includes("/") || value.includes("?") || value.includes("#")) return { valid: false, error: "Only the domain is allowed. No paths or parameters." };
  if (!/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(value)) return { valid: false, error: "Enter a valid Salesforce domain (eg. \"mydomain.salesforce.com\")" };
  if (!isSalesforceHost(value)) return { valid: false, error: "Use your Salesforce domain (eg. \"mydomain.my.salesforce.com\" or \"login.salesforce.com\")" };
  return { valid: true, error: "" };
}
