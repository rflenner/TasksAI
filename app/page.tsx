import { redirect } from "next/navigation";
import { currentActor } from "./lib/session";
import TaskApp from "./TaskApp";
export const dynamic="force-dynamic";
export default async function Home(){if(!await currentActor())redirect("/login");return <TaskApp/>}
