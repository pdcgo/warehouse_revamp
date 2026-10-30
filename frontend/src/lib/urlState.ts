import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";

import { ALL_DATES, type DateRange } from "../components/datetime/DateRangePicker";

// A LIST'S FILTERS LIVE IN THE URL (owner: *"untuk halaman tabel dan list pakai filter, filternya disimpan ke querystring
// biar tidak hilang saat refresh"*, `a-lists-filters-live-in-the-url`):
//
//   /inventories/suppliers?q=sumber&type=1&range=3m
//
// so a refresh, Back from a detail page, or a link pasted to a colleague opens the same narrowed list.
//
// ⚠ THE STATE STAYS LOCAL; THE URL IS ITS MIRROR. A filter reads the URL once, when the page mounts, and from then on
// is ordinary React state that writes itself to the URL. Driving the input FROM the URL would put a router navigation
// between every keystroke and the box showing it — a controlled search that lags, and drops letters.
//
// ⚠ WRITES ARE GATHERED. Clear Filters resets five filters in one click, and five navigations built from the same
// URL would each undo the one before (react-router's own setSearchParams has exactly that bug). Every write made in one
// tick is queued and flushed as ONE `replace` navigation — replace, so Back leaves the list instead of stepping back
// through every letter typed.
//
// ⚠ ITS OWN WRITES ARE NEVER FOLLOWED. A write comes back as a REPLACE navigation, and the router may commit it a
// keystroke late: following it would set the box back to "ca" after "cah" was typed, and the letter is lost. Only a
// URL changed from OUTSIDE — Back (POP), a link (PUSH) — is followed. (Found by the story run under load; alone, every
// story passed.)
//
// ⚠ A VALUE AT ITS DEFAULT IS NOT WRITTEN. An untouched list has a bare URL, and a link without a key means "the default".

/** How one filter's value is written to, and read back from, its query-string key. */
export interface UrlCodec<T> {
  encode: (value: T) => string;
  /** `undefined` for a value this codec cannot read (a hand-edited URL) — the filter then takes its default. */
  decode: (raw: string) => T | undefined;
}

// ── the gathered writes ────────────────────────────────────────────────────────────────────────────

const queue = new Map<string, string | null>();
let flushing = false;
// The URL the next flush builds on: the one just written, which can be AHEAD of the router's while the router commits
// it — so a second flush in that window does not drop the first one's keys. Only for the same page: a write after
// moving to another page starts from that page's URL.
let latest: { pathname: string; search: string } | null = null;

function enqueue(navigate: NavigateFunction, at: { pathname: string; search: string }, key: string, raw: string | null) {
  queue.set(key, raw);
  if (flushing) return;
  flushing = true;
  queueMicrotask(() => {
    flushing = false;
    const params = new URLSearchParams(latest && latest.pathname === at.pathname ? latest.search : at.search);
    for (const [k, v] of queue) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    queue.clear();
    const search = params.toString() ? `?${params.toString()}` : "";
    latest = { pathname: at.pathname, search };
    navigate({ search }, { replace: true, preventScrollReset: true });
  });
}

/**
 * A filter's value, kept in the URL's `key`. Reads the URL when the page mounts, writes every change back (gathered,
 * `replace`), leaves the key out at `fallback`, and follows the URL when it changes from outside — Back, or the menu
 * link to the same page with no filters.
 */
export function useUrlState<T>(key: string, fallback: T, codec: UrlCodec<T>): [T, (next: T | ((prev: T) => T)) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();

  const rawOf = (search: string) => new URLSearchParams(search).get(key);
  const decodeRaw = (raw: string | null): T => (raw === null ? fallback : (codec.decode(raw) ?? fallback));

  const [value, setValue] = useState<T>(() => decodeRaw(rawOf(location.search)));
  const valueRef = useRef(value);
  valueRef.current = value;
  // What this filter last put in the URL (or found there) — a URL that disagrees changed from outside.
  const expected = useRef<string | null>(rawOf(location.search));

  const { pathname, search } = location;
  useEffect(() => {
    // Our own writes come back as REPLACE, possibly behind what has been typed since — never follow them.
    if (navigationType === "REPLACE") return;
    latest = { pathname, search };
    const raw = rawOf(search);
    if (raw !== expected.current) {
      expected.current = raw;
      setValue(decodeRaw(raw));
    }
    // The codec and fallback are a filter's constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, navigationType]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const v = typeof next === "function" ? (next as (prev: T) => T)(valueRef.current) : next;
      valueRef.current = v;
      setValue(v);
      const encoded = codec.encode(v);
      const raw = encoded === codec.encode(fallback) ? null : encoded;
      expected.current = raw;
      enqueue(navigate, { pathname, search }, key, raw);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, pathname, search, key],
  );

  return [value, set];
}

// ── codecs ─────────────────────────────────────────────────────────────────────────────────────────

/** Free text — a search box. */
export const textCodec: UrlCodec<string> = { encode: (v) => v, decode: (raw) => raw };

/** An id — `0n` is "none" and, as a default, is left out. */
export const idCodec: UrlCodec<bigint> = {
  encode: (v) => v.toString(),
  decode: (raw) => (/^\d+$/.test(raw) ? BigInt(raw) : undefined),
};

/** A whole number — an enum's value (a marketplace, an account type). */
export const intCodec: UrlCodec<number> = {
  encode: (v) => String(v),
  decode: (raw) => (/^-?\d+$/.test(raw) ? Number(raw) : undefined),
};

/** A proto enum's value — only the values given are read back (a marketplace, a team type). */
export function enumCodec<T extends number>(values: readonly T[]): UrlCodec<T> {
  return {
    encode: (v) => String(v),
    decode: (raw) => {
      const n = Number(raw);
      return /^-?\d+$/.test(raw) && (values as readonly number[]).includes(n) ? (n as T) : undefined;
    },
  };
}

/** A switch — `1` or `0`. */
export const boolCodec: UrlCodec<boolean> = {
  encode: (v) => (v ? "1" : "0"),
  decode: (raw) => (raw === "1" ? true : raw === "0" ? false : undefined),
};

/** One of a fixed set of words — a view, a grain, a ranking. */
export function oneOfCodec<T extends string>(values: readonly T[]): UrlCodec<T> {
  return { encode: (v) => v, decode: (raw) => (values as readonly string[]).includes(raw) ? (raw as T) : undefined };
}

/** A value that may be absent — `undefined` is written as nothing. */
export function optionalCodec<T>(codec: UrlCodec<T>): UrlCodec<T | undefined> {
  return {
    encode: (v) => (v === undefined ? "" : codec.encode(v)),
    decode: (raw) => (raw === "" ? undefined : codec.decode(raw)),
  };
}

/** A value that may be `null` — a sort left at the list's own order. `null` is written as nothing. */
export function nullableCodec<T>(codec: UrlCodec<T>): UrlCodec<T | null> {
  return {
    encode: (v) => (v === null ? "" : codec.encode(v)),
    decode: (raw) => (raw === "" ? null : codec.decode(raw)),
  };
}

/** Several of one kind, comma-joined — picked types, picked ids. */
export function listCodec<T>(codec: UrlCodec<T>): UrlCodec<T[]> {
  return {
    encode: (v) => v.map(codec.encode).join(","),
    decode: (raw) => {
      if (raw === "") return [];
      const items = raw.split(",").map(codec.decode);
      return items.every((x) => x !== undefined) ? (items as T[]) : undefined;
    },
  };
}

/** A sort — `name:asc`. Only the columns given are read back. */
export function sortCodec<K extends string>(columns: readonly K[]): UrlCodec<{ by: K; dir: "asc" | "desc" }> {
  return {
    encode: (v) => `${v.by}:${v.dir}`,
    decode: (raw) => {
      const [by, dir] = raw.split(":");
      if (!(columns as readonly string[]).includes(by ?? "") || (dir !== "asc" && dir !== "desc")) return undefined;
      return { by: by as K, dir };
    },
  };
}

/**
 * A date range — `7d`, `3m`, `2026-10-01..2026-10-15` (an open end left blank: `..2026-10-15`), `all`. A relative
 * range stays relative in the URL, so a link opened tomorrow still means "the last 7 days".
 */
export const dateRangeCodec: UrlCodec<DateRange> = {
  encode: (v) => {
    if (v.kind === "relative") return v.months !== undefined ? `${v.months}m` : `${v.days}d`;
    if (!v.from && !v.to) return "all";
    return `${v.from}..${v.to}`;
  },
  decode: (raw) => {
    if (raw === "all") return ALL_DATES;
    const relative = raw.match(/^(\d+)([dm])$/);
    if (relative) {
      const n = Number(relative[1]);
      if (n < 1) return undefined;
      return relative[2] === "m" ? { kind: "relative", months: n } : { kind: "relative", days: n };
    }
    const absolute = raw.match(/^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/);
    if (absolute) return { kind: "absolute", from: absolute[1] ?? "", to: absolute[2] ?? "" };
    return undefined;
  },
};
