import { productClient } from "../../api/clients";

// THE CODES THAT STILL FIND A PRODUCT (backlog #152, #141 P4 — a-team-code-change-recomposes-its-product-codes, its 🔄
// *an old sticker scanned before the reprint*, owner Q1 "A"): when a team's code changes, its products take the new code,
// an order line keeps the code it was written with (🔄 *past lines keep their code*), and the warehouse's shelves wear the
// old stickers until each reprints. So the item scan matches a scan against the line's code, the product's code NOW and
// every code it carried before — read here ONCE per pick page, for the page's products together (ProductCodesByIds),
// never once per scan. A product the warehouse may not read (it never held it) is absent: its line still scans by its
// own code, as before.

/** Each product's other codes that scan as it — its code now first, then its former codes — by product id. */
export type ScanCodes = ReadonlyMap<bigint, readonly string[]>;

/** ProductCodesByIds' cap — a page with more products asks in several reads, all at once. */
export const SCAN_CODES_PER_READ = 200;

export async function readScanCodes(teamId: bigint, productIds: readonly bigint[]): Promise<ScanCodes> {
  const ids = [...new Set(productIds.filter((id) => id > 0n))];
  const codes = new Map<bigint, string[]>();
  if (ids.length === 0) return codes;

  const chunks: bigint[][] = [];
  for (let i = 0; i < ids.length; i += SCAN_CODES_PER_READ) chunks.push(ids.slice(i, i + SCAN_CODES_PER_READ));

  const answers = await Promise.all(chunks.map((chunk) => productClient.productCodesByIds({ teamId, productIds: chunk })));

  for (const answer of answers) {
    for (const [id, item] of Object.entries(answer.items)) {
      codes.set(BigInt(id), [item.productCode, ...item.formerCodes].filter((code) => code !== ""));
    }
  }

  return codes;
}
