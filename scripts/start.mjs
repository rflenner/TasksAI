import { spawnSync } from "node:child_process";
const init=spawnSync(process.execPath,["--import","tsx","scripts/init-db.ts"],{stdio:"inherit",env:process.env});if(init.status!==0)process.exit(init.status??1);
const next=spawnSync(process.platform==="win32"?"node_modules/.bin/next.cmd":"node_modules/.bin/next",["start","-p",process.env.PORT||"3000"],{stdio:"inherit",env:process.env});process.exit(next.status??1);
