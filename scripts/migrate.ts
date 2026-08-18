import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
const url=process.env.DATABASE_URL;if(!url)throw new Error("DATABASE_URL is required");
const sql=postgres(url,{max:1,ssl:process.env.DATABASE_SSL==="disable"?false:"require"});
await sql`CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
for(const name of (await readdir(join(process.cwd(),"drizzle"))).filter(x=>x.endsWith(".sql")).sort()){
 const [done]=await sql`SELECT name FROM app_migrations WHERE name=${name}`;if(done)continue;
 const source=await readFile(join(process.cwd(),"drizzle",name),"utf8");
 await sql.begin(async tx=>{await tx.unsafe(source);await tx`INSERT INTO app_migrations (name) VALUES (${name})`});
 console.log(`Applied migration ${name}`);
}
await sql.end();
