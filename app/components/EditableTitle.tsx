"use client";
import { useEffect, useRef } from "react";
import { commitTitle } from "../lib/editable-title";

// The task drawer's heading, editable right where it is: click it and type —
// there is no separate Subject box any more. It looks like the heading (a
// borderless text area that grows with the text), shows a light outline on
// hover and a stronger one while editing, and saves when you click away or
// press Enter. Escape puts the old text back. The caller keys it by task and
// refresh counter, so a change made elsewhere (voice, another edit) shows up.
export default function EditableTitle({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grows (or shrinks) to fit the text, also when the drawer is resized.
  useEffect(() => {
    const fit = () => {
      const box = ref.current;
      if (!box) return;
      box.style.height = "auto";
      box.style.height = `${box.scrollHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);

  return (
    <h2 className="drawer-title">
      <textarea
        ref={ref}
        rows={1}
        defaultValue={value}
        aria-label="Subject"
        title="Click to edit the subject"
        spellCheck
        onInput={event => { const box = event.currentTarget; box.style.height = "auto"; box.style.height = `${box.scrollHeight}px`; }}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          else if (event.key === "Escape") { event.currentTarget.value = value; event.currentTarget.blur(); }
        }}
        onBlur={event => {
          const next = commitTitle(value, event.currentTarget.value);
          if (next === null) { event.currentTarget.value = value; return; }
          onSave(next);
        }}
      />
    </h2>
  );
}
