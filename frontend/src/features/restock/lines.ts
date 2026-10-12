import type { TFunction } from "i18next";
import type { RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// How a restock LINE reads, shared by the two detail pages.
//
// The tables themselves are not shared — a buyer's table and a receiving warehouse's table show different columns —
// but what a single line MEANS is one answer, and two copies of it is how one page starts rounding a unit price
// differently from the other.

// A line's money is STORED as the total, as the invoice prints it (a-line-is-typed-as-its-total).
export function lineTotal(item: RestockRequestItem): bigint {
  return item.total;
}

// What one piece cost, DERIVED and openly a rounding: 10.000 over 3 pieces shows 3.333 while the line still totals
// 10.000. The server sends the same figure as `price_unit`.
export function unitPrice(item: RestockRequestItem): bigint {
  if (item.count <= 0n) return 0n;

  return item.total / item.count;
}

// Where a line's good units went, as a person would say it — "A-01-1 (60), B-02-1 (30)". Every unit in stock is on a
// placement (there-is-no-unplaced-pile), so there are two cases:
//
//   nothing arrived good → "" (rendered "—").
//   a placement id       → its CODE, because "A-01-3" is painted on the aisle and "7" is not. An id that cannot be
//                          resolved says so, rather than showing a number nobody can walk to.
export function placementLabel(
  t: TFunction,
  item: RestockRequestItem,
  codes: Record<string, string>,
): string {
  return item.placements
    .map((p) => {
      const where = codes[p.placementId.toString()] ?? t("restock.detail.rackUnknown");

      return `${where} (${p.quantity})`;
    })
    .join(", ");
}
