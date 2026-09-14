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
  // Lets a search with no exact match add the typed text itself as a new
  // selected value — the old plain-text Coworkers/Recipients fields let
  // you type anyone, known or not, and that flexibility (a genuinely new
  // hire who isn't in the system yet) shouldn't disappear just because
  // there's now a real list to search. Off for the Access panel's
  // Project/Meeting/Topic scope pickers, which only ever offered picking
  // from an existing list — this doesn't change that.
  allowCreate?: boolean;
  // At most one selection — added 2026-09-14 so Owner could move off its
  // own separate plain <select> onto this same search-first component
  // (Rizan's own "inconsistencies in how we select owners, coworkers, or
  // recipients" feedback, after a long unsearched dropdown got hard to
  // use). Picking an option REPLACES whatever was selected instead of
  // adding to it, and the panel closes right after — a single-select
  // combobox, not "multi-select capped at one". `value`/`onChange` stay
  // arrays either way (0 or 1 items) so every other prop and internal
  // (search, pinning, create-new) works completely unchanged.
  single?: boolean;
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

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Searchable multi-select with the current selection always pinned to the
// top of the list, even while filtering — see app/lib/picklist.ts for the
// exact rule and why. Approved as an interactive prototype on 2026-09-03,
// then fixed against real usage across four rounds of live feedback:
//
// 1. The search box lives at the top of the open panel, not squeezed
//    inline among the chips (it shrank to a sliver once a couple of
//    people were picked).
// 2. Click-outside-to-close wraps trigger + panel together in one ref —
//    it used to watch the trigger only, so clicking an option's
//    mousedown bubbled to the document listener and closed the panel
//    *before* the click that was supposed to select something landed.
// 3. [superseded by #4 below — the "entire field opens a panel with its
//    own separate search box" shape point 1 and 2 were fixing turned out
//    to be the actual problem: "I click on nobody selected and then the
//    search-as-you-type is in the dropdown... I was expecting to type
//    in the same box." Fixed by making the visible trigger row BE the
//    input, not a button that reveals a different one below it —
//    the convention this was missing (GitHub/Linear/Notion-style
//    assignee pickers): click the box, type immediately, right there.]
// 4. A search with no exact match offers "+ Add "<query>"" (allowCreate,
//    on by default) so a genuinely new name isn't a dead end.
export default function ContactPicklist({ label, value, options, onChange, hint, showAvatar = true, allowCreate = true, single = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const panelId = `${baseId}-panel`;
  const createId = `${baseId}-create`;
  const rowId = (name: string) => `${baseId}-opt-${encodeURIComponent(name)}`;

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function close() { setOpen(false); setQuery(""); setHi(-1); inputRef.current?.blur(); }
  function toggle(name: string) {
    if (single) {
      onChange(value.includes(name) ? [] : [name]);
      close();
      return;
    }
    onChange(value.includes(name) ? value.filter(item => item !== name) : [...value, name]);
    setQuery(""); setHi(-1);
    inputRef.current?.focus();
  }

  const { pinned, rest } = groupOptions(options, value, query);
  const rows = [...pinned, ...rest];
  const trimmedQuery = query.trim();
  const knownElsewhere = (name: string) => [...options, ...value].some(known => known.toLowerCase() === name.toLowerCase());
  const canCreate = allowCreate && trimmedQuery.length > 0 && !knownElsewhere(trimmedQuery);
  // The create affordance counts as one more keyboard-navigable row, one
  // past the real ones — Enter on it creates instead of toggling.
  const maxIndex = rows.length - 1 + (canCreate ? 1 : 0);
  const onCreateRow = canCreate && hi === rows.length;

  return (
    <div className="picklist" ref={wrapRef}>
      <label htmlFor={inputId}>{label}</label>
      {/* The row itself is the input's home, not a button that reveals a
          separate one — the input has flex:1 and fills the row, so
          clicking anywhere on it (not just its exact text) goes
          straight to typing, same as clicking any normal text field. */}
      <div className={`pl-trigger${open ? " open" : ""}`}>
        {value.map(name => (
          <span className="chip" key={name}>
            <span>{name}</span>
            <button type="button" aria-label={`Remove ${name}`} onClick={event => { event.stopPropagation(); toggle(name); }}>×</button>
          </span>
        ))}
        <input
          id={inputId}
          ref={inputRef}
          className="pl-inline-search"
          role="combobox"
          aria-expanded={open}
          aria-controls={panelId}
          aria-activedescendant={hi >= 0 ? (onCreateRow ? createId : rowId(rows[hi])) : undefined}
          autoComplete="off"
          value={query}
          placeholder={value.length === 0 ? "Search…" : ""}
          onFocus={() => setOpen(true)}
          onChange={event => { setQuery(event.target.value); setOpen(true); setHi(-1); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setHi(index => Math.min(index + 1, maxIndex)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setHi(index => Math.max(index - 1, 0)); }
            else if (event.key === "Enter") {
              event.preventDefault();
              if (onCreateRow) toggle(trimmedQuery);
              else if (rows[hi]) toggle(rows[hi]);
            }
            else if (event.key === "Escape") { close(); }
            else if (event.key === "Backspace" && !query && value.length) { toggle(value[value.length - 1]); }
          }}
        />
        <SearchIcon className="pl-search-icon" />
      </div>
      {open && (
        <div id={panelId} className="pl-panel" role="listbox">
          {rows.length === 0 && !canCreate && <div className="pl-empty">{query ? `No matches for "${query}"` : "No options"}</div>}
          {pinned.length > 0 && <div className="pl-group-label">Selected</div>}
          {pinned.map(name => (
            <Row key={name} id={rowId(name)} name={name} query={query} selected showAvatar={showAvatar} highlighted={rows.indexOf(name) === hi} onToggle={() => toggle(name)} />
          ))}
          {rest.length > 0 && <div className="pl-group-label">{pinned.length ? "All options" : "Options"}</div>}
          {rest.map(name => (
            <Row key={name} id={rowId(name)} name={name} query={query} selected={false} showAvatar={showAvatar} highlighted={rows.indexOf(name) === hi} onToggle={() => toggle(name)} />
          ))}
          {canCreate && (
            <div
              id={createId}
              className={`pl-row pl-create${onCreateRow ? " hi" : ""}`}
              role="option"
              aria-selected={false}
              tabIndex={-1}
              onMouseDown={event => event.preventDefault()}
              onClick={() => toggle(trimmedQuery)}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(trimmedQuery); } }}
            >
              <span className="pl-create-plus" aria-hidden="true">+</span>
              <span className="pl-name">Add &quot;{trimmedQuery}&quot;</span>
            </div>
          )}
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
