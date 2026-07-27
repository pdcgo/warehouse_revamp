// Whole-unit quantities typed into a form (a reserved-stock buffer today, any other unit count
// tomorrow). Stock is counted in physical objects, so half of one is not a value a form may produce —
// and "3.7 units" reaching the server as 3 or 4 depending on who rounded is exactly the kind of quiet
// disagreement this lives in one place to prevent.

/**
 * "12" → 12. Returns null for anything that is not a usable whole quantity — a decimal, a negative,
 * a non-number, or past `max` — so a caller can refuse the write instead of storing a 0 for a typo.
 * Empty means 0: leaving the box blank is a real answer ("none"), not an error.
 */
export function parseQuantity(input: string, max = 1_000_000): number | null {
  const trimmed = input.trim();

  if (trimmed === "") {
    return 0;
  }

  const n = Number(trimmed);

  // Integer, not just finite: units are whole things. `Number("")` is 0 and `Number("1e3")` is 1000,
  // both of which are handled above / fine here; "1.5" and "-2" are not.
  if (!Number.isInteger(n) || n < 0) {
    return null;
  }

  // The same rail the database CHECK enforces. Catching it here means a fat finger gets a field
  // error instead of a 500 from a constraint violation.
  if (n > max) {
    return null;
  }

  return n;
}
