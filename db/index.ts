import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const shared = globalThis as unknown as { taskAiSql?: ReturnType<typeof postgres> };
export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  shared.taskAiSql ??= postgres(url, { max: process.env.NODE_ENV === "production" ? 10 : 3, ssl: process.env.DATABASE_SSL === "disable" ? false : "require", idle_timeout: 20, connect_timeout: 10 });
  return shared.taskAiSql;
}
export function getDb() { return drizzle(getSql(), { schema }); }
