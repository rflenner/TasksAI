import LoginClient from "./LoginClient";
// /api/auth/google/callback redirects back here with ?error=<message> on any
// failure (cancelled consent, expired state, unrecognized account) — read
// server-side via searchParams rather than window.location.search client-
// side, so the message renders in the initial HTML with no extra effect
// round trip and no hydration mismatch.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return <LoginClient initialError={params.error || ""} />;
}
