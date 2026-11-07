// WHERE CETAK LABEL PRINTS THESE RESTOCKS — the labels' one address, for one restock or several
// (the-labels-have-one-address, labels-print-several-restocks): `/inventories/restock/labels?ids=503,502`, read back by
// the page as its list. Every way in builds it here — a restock's Cetak, the list's ticked restocks
// (the-list-prints-the-ticked-restocks), the page itself as restocks go on and off, and the old `/:id/labels` redirect.
// The page drops an id that is not a whole number, so a string from a URL is passed as it is.
export function labelsPath(ids: (bigint | string)[]): string {
  return `/inventories/restock/labels?ids=${ids.join(",")}`;
}

/**
 * AT MOST 50 RESTOCKS A PRINT (owner: *"oke, no. 1 semuanya"*, at-most-fifty-restocks-a-print) — the list's largest
 * page, so one tick of its head fills it. Each restock is its own read for now (the-labels-mark-their-one-by-one-read):
 * 50 restocks are up to 100 calls, and the address stays a sane length. The page and the list both stop here.
 */
export const LABELS_MAX_RESTOCKS = 50;
