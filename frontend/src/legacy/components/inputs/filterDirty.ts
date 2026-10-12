// isDirty compares two filter objects over a set of keys, treating "empty" as one value.
//
// The empty-collapsing is the whole subtlety. A filter that has never been touched is `undefined`;
// one that has been set and then cleared is `""`, or `0n`, or `[]`. Those are all the same thing to
// a reader — "not narrowing anything" — but `!==` says they differ, so a naive comparison leaves the
// Apply button lit after the user clears a box they never really used, and Reset offering to reset
// a form that is already at its defaults.
//
// A button that is enabled when nothing has changed is worse than one that is always enabled: it
// implies there is something to apply.
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "bigint") return value === 0n;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function same(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;

  // Arrays are compared by CONTENT, in order. Filter values are frequently id lists, and comparing
  // them by reference makes every re-render look like a change.
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  }

  return a === b;
}

/**
 * True when `value` differs from `against` on any of `keys`.
 *
 * `keys` defaults to the keys of `against` — the applied filters or the defaults — rather than of
 * `value`. That direction matters: the draft may carry extra scratch fields the comparison should
 * ignore, while a key present in the baseline is by definition part of the comparison.
 */
export function isDirty<K extends string>(
  value: Partial<Record<K, unknown>>,
  against: Partial<Record<K, unknown>>,
  keys?: ReadonlyArray<K>,
): boolean {
  const compared = keys ?? (Object.keys(against) as K[]);

  return compared.some((key) => !same(value[key], against[key]));
}
