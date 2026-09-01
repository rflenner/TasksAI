import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "../../db";
import { passkeys } from "../../db/schema";
import { currentActor } from "../lib/session";
import AccountClient from "./AccountClient";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  const actor = await currentActor();
  if (!actor?.id) redirect("/login?returnTo=/account");
  const rows = await getDb().select({ id: passkeys.id, deviceLabel: passkeys.deviceLabel, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt }).from(passkeys).where(eq(passkeys.userId, actor.id)).orderBy(passkeys.createdAt);
  const initialPasskeys = rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null }));
  return <AccountClient initialPasskeys={initialPasskeys} />;
}
