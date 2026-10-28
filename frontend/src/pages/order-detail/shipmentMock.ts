import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// THE ORDER LEG'S COURIER TRAIL — invented, because nothing reads the courier back yet.
//
// The leg itself is real: `Order` stores the carrier code and the printed number (`receipt_code`). The
// trail — where the parcel is, and when the courier scanned it — is not modelled at all.
//
// ⚠ THERE IS NO RETURN LEG (the-return-leg-waits-for-tracking). There is no return shipment record —
// no return courier, no return resi, no return trail — and the return resi is asked again when tracking
// is designed, because a return trail cannot exist before tracking does.
//
// ⚠ DELETE THIS FILE the day the trail has a source. Every row is a lie with an end date.
//
// ⚠ DERIVED FROM THE ORDER ID, never random: a trail that changed between renders is the one thing
// nobody could sanity-check.

export interface TrailEvent {
  at: bigint;
  /** What the courier reported, in the courier's own words — which is why it is not translated. */
  text: string;
  place: string;
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
