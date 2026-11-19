// THE PRINT PAGE'S ONE ADDRESS — `/warehouse-orders/print?ids=101,102`, the chosen orders in the list's order, so a
// refresh prints the same set (as the restock labels' one address, the-labels-have-one-address). The list's Cetak Resi
// opens it with the ticked orders, a row's Print Label with its one order (a-rows-print-label-opens-the-print-page).

/** OrderLabels takes 1 to 50 ids — the warehouse list's largest page (a-warehouse-prints-the-labels-of-orders-it-ships). */
export const PRINT_RECEIPTS_MAX = 50;

/** The print page's address for these orders. */
export function printReceiptsPath(ids: readonly (bigint | string)[]): string {
  return `/warehouse-orders/print?ids=${ids.map(String).join(",")}`;
}

/** The orders on the print, read from the address: every id once, in order; not a whole number → dropped; past 50 → left off. */
export function printIdsOf(search: string): bigint[] {
  const parts = (new URLSearchParams(search).get("ids") ?? "").split(",");
  const ids: bigint[] = [];

  for (const part of parts) {
    if (ids.length >= PRINT_RECEIPTS_MAX) break;
    const p = part.trim();
    if (!/^\d+$/.test(p)) continue;
    const id = BigInt(p);
    if (id > 0n && !ids.includes(id)) ids.push(id);
  }

  return ids;
}
