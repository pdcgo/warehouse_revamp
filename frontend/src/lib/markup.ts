// The CROSS markup — what another team pays over our cost when it sells one of our products on its
// own order — travels as BASIS POINTS (1/100 of a percent) and is read and typed as PERCENT.
//
// The conversion lives here, in one place, because it is the kind of thing that gets re-derived
// slightly differently in a form and a table until the two disagree by a factor of a hundred.

/** 1250 → "12.5%". Trailing zeros are dropped: 1500 reads "15%", not "15.00%". */
export function formatMarkup(bps: number): string {
  return `${formatMarkupValue(bps)}%`;
}

/** 1250 → "12.5" — the value an input holds, without the sign. */
export function formatMarkupValue(bps: number): string {
  // toFixed then strip, rather than dividing and hoping: 1/100 of a percent is exactly two decimals,
  // and float division alone yields things like 12.299999999999999.
  return (bps / 100).toFixed(2).replace(/\.?0+$/, "");
}

/**
 * "12.5" → 1250. Returns null for anything that is not a usable percent, so a caller can refuse the
 * write rather than silently store a 0 for a typo.
 */
export function parseMarkupPercent(input: string): number | null {
  const trimmed = input.trim();

  if (trimmed === "") {
    return 0;
  }

  const n = Number(trimmed);

  if (!Number.isFinite(n) || n < 0) {
    return null;
  }

  const bps = Math.round(n * 100);

  // The same rail the database CHECK enforces (0..100000 bps = 0..1000%). Catching it here means a
  // fat finger gets a field error instead of a 500 from a constraint violation.
  if (bps > 100_000) {
    return null;
  }

  return bps;
}
