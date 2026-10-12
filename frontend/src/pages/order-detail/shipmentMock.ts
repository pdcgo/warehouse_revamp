import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// THE TWO LEGS OF A PARCEL'S LIFE, AND THE TEXT THE BUYER ACTUALLY ORDERED — invented, because the
// contract carries neither.
//
// ⚠ A PARCEL CAN TRAVEL TWICE (owner: *"resi bisa 2 dan jejak pengiriman juga bisa 2, dari order dan
// return"*). Out to the buyer, and — when it comes back — back to the warehouse, under a DIFFERENT
// tracking number and often a different courier. Each leg has its own number and its own trail:
//
//   order leg   courier · resi · ship-by deadline · trail
//   return leg  courier · resi ·                    trail     (only once a return exists)
//
// Neither leg is modelled. `Order` stores the carrier code and the attached slip FILE, not the printed
// number; there is no return at all — no status, no number, no trail.
//
// ⚠ DELETE THIS FILE the day the legs have a source. Every row is a lie with an end date.
//
// ⚠ DERIVED FROM THE ORDER ID, never random: a trail that changed between renders is the one thing
// nobody could sanity-check.

export interface TrailEvent {
  at: bigint;
  /** What the courier reported, in the courier's own words — which is why it is not translated. */
  text: string;
  place: string;
}

export interface ShipmentLeg {
  courier: string;
  receiptCode: string;
  trail: TrailEvent[];
}

const HOUR = 3_600n;

/**
 * The outbound leg's trail — **only once the parcel has left**.
 *
 * ⚠ AN UNSHIPPED ORDER HAS NO TRAIL, and that is most orders on the screen at any moment: the resi
 * exists from confirmation (the label is printed then), the trail only from the first courier scan.
 * So the number shows and the trail says "nothing yet", which is the honest pair.
 */
export function mockOutboundTrail(orderId: bigint, status: OrderStatus, createdAt: bigint): TrailEvent[] {
  if (status !== OrderStatus.SHIPPED) {
    return [];
  }

  const start = createdAt + 26n * HOUR + BigInt(Number(orderId) % 5) * HOUR;

  return [
    { at: start, text: "Paket diserahkan ke kurir", place: "Gudang Pusat, Bandung" },
    { at: start + 7n * HOUR, text: "Paket tiba di hub sortir", place: "Hub Cimahi" },
    { at: start + 20n * HOUR, text: "Paket dalam pengiriman", place: "Hub Jakarta Barat" },
    { at: start + 30n * HOUR, text: "Paket diterima oleh yang bersangkutan", place: "Jakarta Barat" },
  ];
}

/**
 * The RETURN leg — for the one fixture that has been returned, and nothing else.
 *
 * ⚠ MOST ORDERS NEVER RETURN, so the leg is absent almost everywhere and the section says "no return"
 * in one line. It is invented for order 108 only — shipped long ago — so the two-leg shape can be seen
 * populated at least once.
 */
export function mockReturnLeg(orderId: bigint, createdAt: bigint): ShipmentLeg | undefined {
  if (orderId !== 108n) {
    return undefined;
  }

  const start = createdAt + 9n * 24n * HOUR;

  return {
    courier: "SICEPAT",
    receiptCode: "SCP0041870532",
    trail: [
      { at: start, text: "Paket retur dijemput kurir", place: "Jakarta Barat" },
      { at: start + 18n * HOUR, text: "Paket retur tiba di hub sortir", place: "Hub Cimahi" },
      { at: start + 29n * HOUR, text: "Paket retur diterima gudang", place: "Gudang Pusat, Bandung" },
    ],
  };
}

/**
 * The product as the MARKETPLACE named it — the text the order draft scraped (owner: *"di draft itu ada
 * teks khusus untuk nama produknya, jadi teks itu harusnya juga tampil di sini"*).
 *
 * ⚠ THE DRAFT KEEPS IT AND THE ORDER THROWS IT AWAY. `OrderDraftItem.external_name` is "never
 * overwritten … the evidence of what the buyer actually ordered, and keeping it beside the mapping is
 * what lets somebody tell a wrong mapping from a right one" (order_draft.proto). `OrderItem` has no
 * such field, so the evidence is lost at the exact moment it starts to matter — when the goods are
 * picked against the mapping.
 *
 * ⚠ ONLY FOR AN ORDER THAT CAME FROM A STOREFRONT. A phone order was typed by a person against our own
 * catalogue; there was never a marketplace title, and an invented one would be worse than none.
 */
export function mockExternalName(
  orderRef: string,
  name: string,
  lineIndex: number,
): { name: string; sku: string } | undefined {
  if (orderRef.trim() === "") {
    return undefined;
  }

  // Marketplace titles are long, keyword-stuffed and nothing like our catalogue's — which is the point
  // of showing both: the mismatch is what a wrong mapping looks like, and a mock that echoed our own
  // name would hide it.
  const flavour = [
    "Premium Cotton Combed 30s Unisex Original Murah",
    "Bahan Adem Tebal Tidak Menerawang Best Seller",
    "Rajut Halus Anti Luntur Grosir Promo",
  ][lineIndex % 3];

  return {
    name: `${name} ${flavour}`,
    sku: `MP-${orderRef.slice(-4)}-${lineIndex + 1}`,
  };
}
