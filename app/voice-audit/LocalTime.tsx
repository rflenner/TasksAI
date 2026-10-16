"use client";
import { useSyncExternalStore } from "react";

// Server render and hydration show UTC (clearly labelled); once mounted in
// the browser it switches to the viewer's own timezone. useSyncExternalStore
// is the supported way to do that without a hydration mismatch.
const subscribe = () => () => {};
const OPTIONS: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" };
export default function LocalTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => new Date(iso).toLocaleString("en-GB", OPTIONS),
    () => `${new Date(iso).toLocaleString("en-GB", { ...OPTIONS, timeZone: "UTC" })} UTC`,
  );
  return <time dateTime={iso} className="whitespace-nowrap">{text}</time>;
}
