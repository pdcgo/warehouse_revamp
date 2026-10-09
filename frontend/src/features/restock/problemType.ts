import type { TFunction } from "i18next";
import { RestockProblemType } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// The display name of a problem row's type, read-only — the detail pages' broken and missing columns.
//
// There is no picker: at the door the warehouse types a BROKEN count, and MISSING is worked out
// (a-short-unit-at-the-door-is-missing). UNSPECIFIED returns "" — it means "not recorded", not a third kind.
export function problemTypeLabel(t: TFunction, type: RestockProblemType): string {
  switch (type) {
    case RestockProblemType.BROKEN:
      return t("restock.problem.broken");
    case RestockProblemType.MISSING:
      return t("restock.problem.missing");
    default:
      return "";
  }
}
