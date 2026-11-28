// THE CODES THAT STILL FIND A PRODUCT (backlog #152, #141 P4 — a-team-code-change-recomposes-its-product-codes, its 🔄
// *an old sticker scanned before the reprint*, owner Q1 "A") — the stub's one truth about a product's FORMER codes, read by
// ProductCodesByIds (productCodeStub.ts) and by the searches that match a former code whole (productStub's ProductList,
// the warehouse's list and picker): the product's history (teamCodeStub.ts — the Riwayat Produk lines), unless a story
// says otherwise with `scanCodesForStory`.
//
// Kept apart from productCodeStub.ts so productStub.ts can read it without importing the handler (which reads the
// catalogue back).

import { formerCodesInHistory } from "./teamCodeStub";

/** What the screens asked this story — each ProductCodesByIds call, in order. Reset per story (productStub's reset). */
export const productCodeScenario = {
  calls: [] as { teamId: bigint; productIds: bigint[] }[],
};

let scanCodes = new Map<bigint, { live: string; former: string[] }>();

export function resetProductCodeScenario() {
  productCodeScenario.calls.length = 0;
  scanCodes = new Map();
}

/**
 * A `beforeEach`: the asking warehouse holds `productId`, whose code now is `live` and which carried `former` before (newest
 * first) — for the pick pages' order and parcel lines, whose products the catalogue fixture does not hold (301–303).
 */
export function scanCodesForStory(productId: bigint, live: string, ...former: string[]) {
  return () => {
    scanCodes.set(productId, { live, former });
  };
}

/** A story's codes for `productId`, when it set them. */
export function storyScanCodes(productId: bigint): { live: string; former: string[] } | undefined {
  return scanCodes.get(productId);
}

/** The codes `productId` carried before, newest first: the story's, else its history's. */
export function formerCodesOf(productId: bigint): string[] {
  return scanCodes.get(productId)?.former ?? formerCodesInHistory(productId);
}

/** Whether the typed term IS one of the product's former codes — whole, case-insensitive (product_term_clause.go). */
export function isFormerCode(q: string | undefined, productId: bigint): boolean {
  const term = (q ?? "").trim().toLowerCase();

  return term !== "" && formerCodesOf(productId).some((code) => code.toLowerCase() === term);
}
