// THE ONE ROW FACT THE CONTRACT STILL DOES NOT CARRY, INVENTED SO IT CAN BE LOOKED AT (owner).
//
// Who wrote an order NOTE — notes have no record yet. Everything else a row used to borrow from here is the order's own
// now: the tracking number (`receipt_code`), the warehouse fee, the status date and the platform's two dates.
//
// ⚠ DELETE THIS FILE the day order notes have a record. It is derived from the id, never random, so a reader can tell
// a layout bug from noise.

/** Three names, so a list of notes reads as a real mix rather than one repeated. */
const CREATORS = ["Ani Rahayu", "Budi Santoso", "Citra Dewi"];

/** Who wrote an order NOTE — notes have no record yet (`order-detail/notesMock`). Never an order's creator. */
export function mockCreator(id: bigint): string {
  return CREATORS[Number(id) % CREATORS.length]!;
}
