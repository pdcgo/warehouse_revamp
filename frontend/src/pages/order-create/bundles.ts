import type { PickedProduct } from "../../components/products/ProductSelect";
import type { LineDraft } from "../../features/orders/lines";
import { lineFor, toQty } from "../../features/orders/lines";
import type { BundleTemplate } from "./mockData";

// A BUNDLE ON AN ORDER, as the screen holds it while it is being edited.
//
// ⚠ THE ORDER STILL HOLDS PRODUCTS. A bundle is a TEMPLATE — it puts product lines on the order and
// says how many of each — not a thing the warehouse stocks. Everything downstream already works in
// products: stock is drawn per product, HPP is recorded per product, the cross-team fee is charged
// per owning team's products, and a return comes back as products. Making a bundle a catalogue
// entity would mean teaching all four about a unit that never sits on a shelf.
//
// What follows from that, and it is the reason the card can exist at all today: a substituted slot
// re-totals BY ITSELF, because the money side is the sum of what actually went in. A bundle needs no
// price of its own.

/** One slot of an added bundle: the rule it carries, and the products currently filling it. */
export interface SlotDraft {
  id: string;
  label: string;
  /** Units per ONE bundle. The cap is this × the bundle's quantity. */
  ruleQty: number;
  /**
   * What is in the slot. A LIST rather than one product, because the owner's rule is that a slot can
   * be split — "one product empty → substitute another, several products allowed" — and the cap is
   * on the slot's TOTAL, not on any one product in it.
   */
  fills: LineDraft[];
}

export interface BundleDraft {
  /** Unique per ADDED bundle: the same template can go on one order twice. */
  key: string;
  templateId: string;
  name: string;
  /** Kept as a string while editing — an empty input is not 0. */
  quantity: string;
  slots: SlotDraft[];
}

export function bundleFor(template: BundleTemplate, key: string): BundleDraft {
  return {
    key,
    templateId: template.id,
    name: template.name,
    quantity: "1",
    slots: template.slots.map((slot) => ({
      id: slot.id,
      label: slot.label,
      ruleQty: slot.ruleQty,
      // The default product, at the rule's quantity for one bundle. Substituting is untick/tick in
      // the same picker the order's own lines use, so a slot is filled the way a line is picked.
      fills: [
        {
          ...lineFor({ id: slot.productId, sku: slot.sku, name: slot.name }),
          quantity: String(slot.ruleQty),
        },
      ],
    })),
  };
}

/**
 * A newly ticked product, as a slot fill.
 *
 * It starts at the slot's rule for ONE bundle rather than at 1: a substitute is standing in for what
 * the bundle says should be there, so the quantity somebody means is the one the slot was already
 * carrying. They can still type over it.
 */
export function fillFor(product: PickedProduct, ruleQty: number): LineDraft {
  return { ...lineFor(product), quantity: String(Math.max(ruleQty, 1)) };
}

/** How many units this slot may hold: the bundle's rule × how many bundles were ordered. */
export function slotCap(slot: SlotDraft, bundleQuantity: string): number {
  return slot.ruleQty * toQty(bundleQuantity);
}

/** How many units are actually in it, across every product filling it. */
export function slotFilled(slot: SlotDraft): number {
  return slot.fills.reduce((sum, f) => sum + toQty(f.quantity), 0);
}

/**
 * Every product line a bundle puts on the order, flattened.
 *
 * This is what the rest of the screen sees: stock and HPP are read for these ids alongside the
 * manually picked ones, and they are counted into the totals and the invoice the same way. Nothing
 * downstream of this function knows a bundle was involved.
 */
export function bundleLines(bundles: BundleDraft[]): LineDraft[] {
  return bundles.flatMap((b) => b.slots.flatMap((s) => s.fills));
}
