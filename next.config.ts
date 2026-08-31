import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // microphone=(self) — the app itself is the only allowed origin, and
      // only because of "Dictate task" / the voice-test comparison page;
      // this was camera=(), microphone=(), geolocation=() from the very
      // first commit, long before any voice feature existed. It silently
      // blocked mic access on every page, in every browser that actually
      // enforces this header (Chrome does, strictly; Safari's enforcement
      // of it has long been looser, which is why the exact same bug was
      // invisible there and only ever showed up as Chrome-specific).
      // Camera and geolocation stay fully blocked — nothing in the app
      // uses either.
      { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};

export default nextConfig;
