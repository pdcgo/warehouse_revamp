// THE NUMBERS NOTHING SERVES YET.
//
// Everything here stands in for a read that does not exist: bundle templates (no contract), and a
// creditor's terms toward this team (`LiabilityTerms` is scoped to the team that OWNS the terms, so
// a debtor cannot ask what limit it is under — see the plan). The page is not routed, so these
// figures never appear in front of a real operator; they exist so the layout can be reviewed with
// money on it rather than a page of em dashes.
//
// ⚠ NOT FIXTURES. `.storybook/fixtures.ts` is what the stub transport serves — real shapes for real
// RPCs. This file is the opposite: values for calls that have no RPC at all.

// ── Bundles ─────────────────────────────────────────────────────────────────────────────────────

/**
 * One slot of a bundle: what goes in it, and HOW MANY per bundle.
 *
 * The slot is the unit the owner described — "one product empty → substitute another, several
 * products allowed, max qty = the bundle's rule × the bundle qty". So the rule lives on the slot and
 * the products filling it are a list, not a field.
 */
export interface BundleSlotTemplate {
  id: string;
  /** What the slot is FOR, in the bundle's own words — "Coffee", not the product's name. */
  label: string;
  /** How many units of this slot go in ONE bundle. The cap is this × the bundle quantity. */
  ruleQty: number;
  /** What normally fills it. Substituting replaces it; the slot keeps its rule. */
  productId: bigint;
  sku: string;
  name: string;
}

export interface BundleTemplate {
  id: string;
  name: string;
  slots: BundleSlotTemplate[];
}

// The product ids are the Storybook fixtures' (71–74), so a slot's stock and HPP resolve through the
// SAME reads the manual lines use and the card shows real figures rather than invented ones.
//
// Both templates deliberately contain a product owned by ANOTHER team (73 is Toko Kenanga's, 74 is
// Toko Melati's) — that is what makes the return-mapping card and the per-creditor invoice fill on a
// screen somebody is only looking at.
export const BUNDLES: BundleTemplate[] = [
  {
    id: "hampers",
    name: "Hampers Lebaran",
    slots: [
      { id: "coffee", label: "Coffee", ruleQty: 2, productId: 71n, sku: "SKU-KOPI-250", name: "Kopi Arabika 250g" },
      { id: "tea", label: "Tea", ruleQty: 1, productId: 72n, sku: "SKU-TEH-100", name: "Teh Melati 100g" },
      { id: "sugar", label: "Sugar", ruleQty: 1, productId: 73n, sku: "SKU-GULA-1K", name: "Gula Pasir 1kg" },
    ],
  },
  {
    id: "kitchen",
    name: "Paket Dapur",
    slots: [
      { id: "rice", label: "Rice", ruleQty: 1, productId: 74n, sku: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg" },
      { id: "sugar", label: "Sugar", ruleQty: 2, productId: 73n, sku: "SKU-GULA-1K", name: "Gula Pasir 1kg" },
    ],
  },
];

// ── A creditor's terms toward this team ─────────────────────────────────────────────────────────

/**
 * What `LiabilityTerms` holds for one creditor → this debtor, plus what is currently owed.
 *
 * `creditLimit` follows the contract's three states exactly, because the UI below depends on telling
 * them apart: `undefined` = UNLIMITED, `0n` = frozen, `n` = a real ceiling. They are not degrees of
 * the same thing — see CreditMeter.
 */
export interface MockTerms {
  /** A flat fee the warehouse charges for fulfilling one order. Charged at order creation. */
  handlingFee: bigint;
  /** What the owning team takes when this team sells its goods, in BASIS POINTS over the HPP. */
  markupBp: bigint;
  /** undefined = unlimited, 0n = frozen, n = the ceiling. */
  creditLimit?: bigint;
  /** What this team owes that creditor right now, as a positive number. */
  debt: bigint;
}

const TERMS: Record<string, MockTerms> = {
  // Gudang Pusat — the warehouse most orders ship from, and comfortably inside its limit.
  "11": { handlingFee: 2_500n, markupBp: 0n, creditLimit: 5_000_000n, debt: 2_100_000n },
  // Toko Kenanga — a product owner sitting at 87% of its limit, so the meter's warning state is
  // reachable by picking one of its products rather than by editing this file.
  "13": { handlingFee: 0n, markupBp: 150n, creditLimit: 2_000_000n, debt: 1_740_000n },
  // Gudang Cabang — UNLIMITED, which must read as words and not as a full bar.
  "14": { handlingFee: 3_000n, markupBp: 0n, creditLimit: undefined, debt: 860_000n },
  // Toko Anggrek — the big catalogue, and the steepest markup.
  "15": { handlingFee: 0n, markupBp: 500n, creditLimit: 1_000_000n, debt: 190_000n },
};

// ── The remembered return mapping ───────────────────────────────────────────────────────────────

// WHAT WE MAPPED THIS PRODUCT TO LAST TIME — the business doc's Product LinkMap, mocked.
//
// The point of remembering is that the question stops being asked: the first order carrying another
// team's product needs a decision, every order after it arrives with the answer already in place. So
// this is READ when a cross line appears and WRITTEN when somebody answers one.
//
// ⚠ MODULE-LEVEL AND SESSION-LIVED. It survives re-renders and re-adding a product, which is exactly
// the behaviour being reviewed, and dies with the page — there is no table behind it yet. The seeded
// pair below is arbitrary (the fixtures hold no real link): it exists so the pre-filled state is
// visible on the first look rather than only after somebody has mapped something.
const REMEMBERED = new Map<string, { productId: bigint; name: string }>([
  ["73", { productId: 74n, name: "Beras Pandan Wangi 5kg" }],
]);

export function rememberedLink(crossProductId: bigint): { productId: bigint; name: string } | undefined {
  return REMEMBERED.get(crossProductId.toString());
}

export function rememberLink(
  crossProductId: bigint,
  mapped: { productId: bigint; name: string },
): void {
  REMEMBERED.set(crossProductId.toString(), { productId: mapped.productId, name: mapped.name });
}

/** Forgetting is part of it: clearing a row must not leave the old pair to come straight back. */
export function forgetLink(crossProductId: bigint): void {
  REMEMBERED.delete(crossProductId.toString());
}

/**
 * The terms for one creditor. Deterministic for a team not listed above — the same team always
 * reads the same numbers, so a screenshot taken twice looks the same.
 */
export function mockTerms(teamId: bigint): MockTerms {
  const known = TERMS[teamId.toString()];
  if (known) return known;

  return {
    handlingFee: 2_000n,
    markupBp: 250n,
    creditLimit: 3_000_000n,
    debt: ((teamId * 137_000n) % 2_400_000n) + 100_000n,
  };
}
