import type { TFunction } from "i18next";
import type { RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// How a restock LINE reads, shared by the two detail pages (#105 / #133).
//
// The tables themselves are not shared — a buyer's table and a receiving warehouse's table show
// different columns, which is the whole reason the pages were split — but what a single line MEANS
// is one answer, and two copies of it is how one page starts rounding a unit price differently from
// the other.

// A line's money is STORED as the total (#140) — the number typed off the invoice — so there is
// nothing left to compute.
export function lineTotal(item: RestockRequestItem): bigint {
  return item.totalPrice;
}

// What one piece cost, DERIVED and openly a rounding: 10.000 over 3 pieces shows 3.333 while the
// line still totals 10.000. The two columns can therefore look a rupiah apart, and that is the
// honest picture — the invoice said 10.000, and no per-piece figure divides it exactly.
export function unitPrice(item: RestockRequestItem): bigint {
  if (item.quantity <= 0n) return 0n;

  return item.totalPrice / item.quantity;
}

// Where a line's goods ended up, as a person would say it (#137). Three cases, and collapsing any
// two of them would misreport where the stock physically is:
//
//   nothing arrived → "" (rendered "—"). There are no placements at all, and saying "Unplaced" would
//                     invent a pile of nothing for someone to go looking for.
//   unplaced        → the not-yet-shelved pile — a REAL place, not an absence. Worded by RackSelect's
//                     own key, so the accept screen and this page cannot phrase one state two ways.
//   a rack id       → the rack's CODE. "A-01-3" is painted on the aisle; "7" is not, so an id we
//                     cannot resolve (the list failed, or the rack has since been deleted) says
//                     exactly that instead of showing a number nobody can walk to. It must not fall
//                     back to "Unplaced" either — that is a different fact, and it would send someone
//                     to the wrong end of the warehouse.
//
// SEVERAL PLACES ARE ORDINARY (#154): a delivery of 100 across three shelves reads as
// "A-01-1 (60), B-02-1 (30), Unplaced (10)". The quantity is shown per place because "it is on three
// shelves" without saying how many are on each is not enough to go and pick it.
export function rackLabel(
  t: TFunction,
  item: RestockRequestItem,
  codes: Record<string, string>,
): string {
  return item.placements
    .map((p) => {
      const where =
        p.place.case === "rackId"
          ? (codes[p.place.value.toString()] ?? t("restock.detail.rackUnknown"))
          : t("racks.select.unplaced");

      return `${where} (${p.quantity})`;
    })
    .join(", ");
}
