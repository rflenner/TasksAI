import { getSql } from "../db";
import { syncSalesAI } from "../app/lib/sales-ai-sync";

// Runs 6x/day (see render.yaml) as a Render Cron Job. Always today's
// calendar date for both start and end, same as the manual "Sync now"
// button's default — running this several times across the day naturally
// picks up new items as they land, and re-processing the same items on
// each run is a safe no-op (skipped via the externalId uniqueness
// constraint on tasks — see db/schema.ts), so there's no need for a
// narrower or offset window.
const today = new Date().toISOString().slice(0, 10);
const result = await syncSalesAI({ startDate: today, endDate: today });
console.log(`Sales AI sync done: ${result.itemsFound} found, ${result.qualifying} qualifying, ${result.created} created, ${result.alreadySynced} already synced, ${result.contactsUpserted} contacts upserted`);
await getSql().end();
