// One shared "everyone resolveTaskNames should be willing to match
// against" query — requested 2026-09-10 after a real report where a
// REGISTERED user's own first name never resolved via AI extraction.
// Previously each caller built its own, inconsistent candidate list:
// app/api/extract/route.ts and app/api/voice-query/route.ts checked only
// registered Task AI accounts (users), while app/api/webhooks/inbound-
// email/route.ts already went further and also checked Sales AI contacts
// (contacts) — a real, working precedent for widening the pool this just
// generalizes. Now also adds a third source: dimensionValues' own
// "person" entries, i.e. the exact same suggestion list ContactPicklist
// shows in the UI — anyone already named as an owner/collaborator/
// recipient on some real task before, registered account or not. All
// three merged, so every entry point resolves against the same complete
// picture of "who Task AI already knows about," not whichever subset
// that one call site happened to query.
//
// Deliberately filters dimensionValues down to multi-word entries only:
// a single bare first name there is almost always the RESULT of an
// earlier failed match (someone's name that never resolved, stored as
// literally "Drew") — including it as a candidate would just add a
// second, spurious match for that same first name and trip
// resolveRegisteredName's own ambiguity guard, rejecting BOTH real
// candidates instead of picking the right one.
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { contacts, dimensionValues, users } from "../../db/schema";

export async function getKnownPersonNames(): Promise<string[]> {
  const [userRows, contactRows, personRows] = await Promise.all([
    getDb().select({ name: users.name }).from(users),
    getDb().select({ name: contacts.name }).from(contacts),
    getDb().select({ value: dimensionValues.value }).from(dimensionValues).where(eq(dimensionValues.type, "person")),
  ]);
  const names = new Set<string>();
  for (const row of userRows) if (row.name.trim()) names.add(row.name.trim());
  for (const row of contactRows) if (row.name.trim()) names.add(row.name.trim());
  for (const row of personRows) if (row.value.trim().includes(" ")) names.add(row.value.trim());
  return [...names];
}
