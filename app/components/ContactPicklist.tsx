"use client";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { groupOptions } from "../lib/picklist";

type Props = {
  label: string;
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
  hint?: string;
  // Off for tag-like option sets (projects/meetings/topics — see
  // app/users/UsersClient.tsx's Scopes) where an avatar circle of initials
  // doesn't read as anything ("Customer Pilot" -> "CP" means nothing next
  // to a project name the way it does next to a person). On by default
  // since every other current use (Owner/Coworkers/Recipients) is people.
  showAvatar?: boolean;
};

function defaultInitials(name: string) {
  return name.split(" ").map(word => word[0]).slice(0, 2).join("").toUpperCase();
}

// Splits `name` around the first case-insensitive match of `query` for a
// <mark> highlight. Plain indexOf, not a regex, so there's no user input
// ever reaching RegExp — a search box is exactly the kind of free-text
// field that turns a naive `new RegExp(query)` into a crash on stray
// regex syntax (an unmatched "(" someone actually typed, say).
function highlight(name: string, query: string) {
  const q = query.trim();
  if (!q) return name;
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return name;
  return (
    <Fragment>
      {name.slice(0, idx)}
      <mark>{name.slice(idx, idx + q.length)}</mark>
      {name.slice(idx + q.length)}
    </Fragment>
  );
}

// Searchable multi-select with the current selection always pinned to the
// top of the list, even while filtering — see app/lib/picklist.ts for the
// exact rule and why. Approved as an interactive prototype on 2026-09-03
// before this was built, then fixed twice against real usage:
//
// 1. The search box now lives at the top of the open panel, not squeezed
//    inline among the chips — reported live (2026-09-03) as confusing
//    once a couple of people were already picked, since the input shrank
//    to a sliver next to their chips. It's also just clearer: opening the
//    field always shows one obvious place to type, sitting directly above
//    the list it filters.
// 2. Click-outside-to-close used to watch only the trigger row, not the
//    open panel below it — since the panel is a sibling, not a DOM
//    descendant, of the trigger, clicking an option's mousedown bubbled
//    straight to the document listener and closed the panel *before* the
//    click that was supposed to select something ever landed, so nothing
//    could actually be picked. The ref now wraps trigger + panel together.
export default function ContactPicklist({ label, value, options, onChange, hint, showAvatar = true }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const rowId = (name: string) => `${baseId}-opt-${encodeURIComponent(name)}`;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDocMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function openPanel() { setOpen(true); }
  function close() { setOpen(false); setQuery(""); setHi(-1); }
  function toggle(name: string) {
    onChange(value.includes(name) ? value.filter(item => item !== name) : [...value, name]);
    setQuery(""); setHi(-1);
    inputRef.current?.focus();
  }

  const { pinned, rest } = groupOptions(options, value, query);
  const rows = [...pinned, ...rest];

  return (
    <div className="picklist" ref={wrapRef}>
      <label htmlFor={inputId}>{label}</label>
      <div className={`pl-trigger${open ? " open" : ""}`}>
        {value.map(name => (
          <span className="chip" key={name}>
            <span>{name}</span>
            <button type="button" aria-label={`Remove ${name}`} onClick={() => toggle(name)}>×</button>
          </span>
        ))}
        {value.length === 0 && <span className="pl-placeholder">Nobody selected</span>}
        <button
          type="button"
          className="pl-open"
          aria-label={`Search ${label.toLowerCase()}`}
          aria-expanded={open}
          aria-controls={`${baseId}-panel`}
          onClick={() => (open ? close() : openPanel())}
        >
          <span className="i i-search" aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div id={`${baseId}-panel`} className="pl-panel" role="listbox">
          <input
            id={inputId}
            ref={inputRef}
            className="pl-search"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${baseId}-panel`}
            aria-activedescendant={hi >= 0 && rows[hi] ? rowId(rows[hi]) : undefined}
            autoComplete="off"
            value={query}
            placeholder="Search…"
            onChange={event => { setQuery(event.target.value); setHi(-1); }}
            onKeyDown={event => {
              if (event.key === "ArrowDown") { event.preventDefault(); setHi(index => Math.min(index + 1, rows.length - 1)); }
              else if (event.key === "ArrowUp") { event.preventDefault(); setHi(index => Math.max(index - 1, 0)); }
              else if (event.key === "Enter") { event.preventDefault(); if (rows[hi]) toggle(rows[hi]); }
              else if (event.key === "Escape") { close(); }
              else if (event.key === "Backspace" && !query && value.length) { toggle(value[value.length - 1]); }
            }}
          />
          {rows.length === 0 && <div className="pl-empty">{query ? `No matches for "${query}"` : "No options"}</div>}
          {pinned.length > 0 && <div className="pl-group-label">Selected</div>}
          {pinned.map(name => (
            <Row key={name} id={rowId(name)} name={name} query={query} selected showAvatar={showAvatar} highlighted={rows.indexOf(name) === hi} onToggle={() => toggle(name)} />
          ))}
          {rest.length > 0 && <div className="pl-group-label">{pinned.length ? "All options" : "Options"}</div>}
          {rest.map(name => (
            <Row key={name} id={rowId(name)} name={name} query={query} selected={false} showAvatar={showAvatar} highlighted={rows.indexOf(name) === hi} onToggle={() => toggle(name)} />
          ))}
        </div>
      )}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Row({ id, name, query, selected, showAvatar, highlighted, onToggle }: { id: string; name: string; query: string; selected: boolean; showAvatar: boolean; highlighted: boolean; onToggle: () => void }) {
  return (
    <div
      id={id}
      className={`pl-row${selected ? " selected" : ""}${highlighted ? " hi" : ""}`}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseDown={event => event.preventDefault()}
      onClick={onToggle}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onToggle(); } }}
    >
      {showAvatar && <span className="pl-avatar">{defaultInitials(name)}</span>}
      <span className="pl-name">{highlight(name, query)}</span>
      <span className="pl-check">{selected ? "✓" : ""}</span>
    </div>
  );
}
