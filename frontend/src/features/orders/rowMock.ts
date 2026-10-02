import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

// THE TWO ROW FACTS THE CONTRACT DOES NOT CARRY, INVENTED SO THE ROW CAN BE LOOKED AT (owner).
//
// `Order` has no tracking number and no creator. Both sit beside something real, so without them the
// row is simply shorter — honest, and impossible to judge a layout from.
// This fills them the way `summaryMock` fills the strip's money and `mockTerms` fills the order form's
// warehouse fee: realistic shapes, fixed values, and a mark on screen saying so.
//
// ⚠ DELETE THIS FILE the day `Order` grows the two fields. It exists to make a preview previewable,
// and every line of it is a lie with an end date.
//
// ⚠ IT IS DERIVED FROM THE ORDER ID, NOT RANDOM. A random filler changes between renders, so a reader
// cannot tell a layout bug from noise — and a resi that differs each time you look is the one thing
// nobody could sanity-check.
//
// ⚠ THE TRACKING NUMBER LOOKS REAL, AND THAT IS DELIBERATE BUT NOT FREE. A realistic shape is what
// makes the cell's width and wrapping judgeable, and it is what `mockTerms` already does with money.
// The cost is that it is copy-pasteable into a courier's website, where it will not be found. It
// lives in Storybook, the header carries the mark, and the day it reaches a routed screen this file
// should be gone.

/** Who typed the order. Three names, so the column reads as a real mix rather than one repeated. */
const CREATORS = ["Ani Rahayu", "Budi Santoso", "Citra Dewi"];

/** The courier prefixes, so two shops' parcels do not all look like one carrier's. */
const CARRIERS = ["JP", "SPX", "AJ"];

/**
 * The tracking number — **every order has one** (owner: *"resi pasti ada"*).
 *
 * ⚠ IT IS NOT ISSUED AT HANDOVER, which is what an earlier version of this assumed. The marketplace
 * prints the label when the order is confirmed, so the number exists while the parcel is still on the
 * shelf — which is exactly why the owner's action table offers *Edit Resi* on `created` and `process`,
 * two states where nothing has shipped yet.
 *
 * So the resi and the ship-by deadline COEXIST: the number says which parcel, the deadline says when it
 * has to go. They share a cell and both lines are occupied until the clock stops.
 */
export function mockReceiptCode(id: bigint, _status: OrderStatus): string {
  const n = Number(id);

  return `${CARRIERS[n % CARRIERS.length]}${(n * 8675309).toString().padStart(10, "0").slice(0, 10)}`;
}

/** Who created the order. Every order has somebody, so this one never returns nothing. */
export function mockCreator(id: bigint): string {
  return CREATORS[Number(id) % CREATORS.length]!;
}

/**
 * THE MARKETPLACE'S OWN ORDER DATE — a different fact from ours.
 *
 * ⚠ IT IS EARLIER THAN OURS, ALWAYS, and that is the point of having both: the buyer ordered on the
 * storefront and somebody typed it in afterwards. A sample where the two were equal would make the
 * second line look like a duplicate of the first and hide the whole reason it exists.
 *
 * ⚠ A PHONE ORDER HAS NONE, and it is the REFERENCE that says so — not the marketplace total. Those
 * are two different absences: an order with no `order_external_ref_id` never came from a storefront
 * (order.proto: `""` is "the ordinary state of an order taken over the phone"), while a marketplace
 * total of 0 only means nobody wrote down what the storefront took. Order 108 is the second case —
 * plainly a marketplace order, with no figure recorded — so keying this off the total would have
 * hidden its order date on the strength of a missing amount.
 */
export function mockMarketplaceCreated(id: bigint, externalRef: string): bigint | undefined {
  if (externalRef.trim() === "") {
    return undefined;
  }

  // Between 8 and 90 minutes before we wrote it down, varying by id so the gap is not a constant.
  return BigInt(480 + (Number(id) % 14) * 360);
}

/**
 * WHEN THE ORDER ENTERED THE STAGE BEING FILTERED.
 *
 * ⚠ THIS IS THE ONE `OrderEvent` ALREADY HAS A SHAPE FOR — `kind` + `at_unix` — and the one the list
 * cannot read: events are populated by `OrderDetail` only. So the shape is right and the source is
 * missing, which is exactly what the mark says.
 *
 * Returned as an OFFSET from the order's creation, so a transition is never before the order existed.
 */
export function mockStageOffset(id: bigint, stageId: string): bigint | undefined {
  const steps: Record<string, number> = {
    processed: 3 * 3600,
    shipped: 26 * 3600,
    completed: 4 * 86400,
    problem: 3 * 86400,
    lost: 9 * 86400,
    return: 6 * 86400,
    cancel: 2 * 3600,
  };

  const base = steps[stageId];

  return base === undefined ? undefined : BigInt(base + (Number(id) % 7) * 1800);
}

/**
 * THE WAREHOUSE'S FEE for fulfilling one order.
 *
 * ⚠ IT IS THE HALF THAT MAKES THE HEADLINE TOTAL A SAMPLE. Nothing carries this per order: the real
 * charge is a liability ledger row keyed by `source_id = order id`, and `LiabilityLogListFilter`
 * takes a counterparty and nothing else — so it is recorded, attributable and unreadable (balance Q9).
 *
 * A flat figure rather than a percentage, matching what `mockTerms` already invents on the order
 * form, so the two previews do not disagree about what a fee looks like.
 */
export function mockWarehouseFee(id: bigint): bigint {
  return BigInt(2000 + (Number(id) % 5) * 500);
}

// ── For the WAREHOUSE's row (`the-warehouse-row-is-the-old-systems-columns`) ──────────────────────

const SHOP_SUFFIXES = ["Official", "Store", "Mart"];
const SHOP_MARKETPLACES = [Marketplace.SHOPEE, Marketplace.TOKOPEDIA, Marketplace.TIKTOK, Marketplace.LAZADA];

/**
 * THE SELLER'S SHOP, as a warehouse would see it — named after the SELLING team, so a row never shows one
 * seller's order under another seller's shop. ⚠ A warehouse cannot read it: `ShopList` is scoped to the
 * selling team, and the order carries only `shop_id`. Undefined for an order with no marketplace
 * reference — a phone order has no storefront.
 */
export function mockSellerShop(
  id: bigint,
  externalRef: string,
  teamName: string,
): { name: string; marketplace: Marketplace } | undefined {
  if (externalRef.trim() === "") return undefined;

  const n = Number(id);
  const base = teamName.replace(/^Toko\s+/i, "") || "Toko";

  return {
    name: `${base} ${SHOP_SUFFIXES[n % SHOP_SUFFIXES.length]}`,
    marketplace: SHOP_MARKETPLACES[n % SHOP_MARKETPLACES.length]!,
  };
}

/** How many units the order holds. ⚠ A list result carries no items, so the warehouse row cannot count them. */
export function mockQuantity(id: bigint): number {
  return 1 + (Number(id) % 6);
}
