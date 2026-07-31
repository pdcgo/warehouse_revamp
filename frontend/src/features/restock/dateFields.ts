import { RestockDateField } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// THE THREE DATES A RESTOCK HAS, offered as the range picker's field segment (#224's `fields` API).
// One control therefore picks BOTH which timestamp and which window.
//
// It lives in features/ rather than on a page because BOTH restock lists now offer it — the buyer's
// and the warehouse's. A restock has exactly three dates whatever screen you read it on, and two
// copies of that list is how one list quietly gains a fourth option, or drops `cancelled`, and the
// two screens start disagreeing about what "the date" means.
//
// The labels are KEYS, not text: the picker is rendered inside a component that has `t`, and putting
// resolved strings here would make this module need one too.
export const RESTOCK_DATE_FIELDS: { value: RestockDateField; labelKey: string }[] = [
  { value: RestockDateField.CREATED, labelKey: "restock.dateField.created" },
  { value: RestockDateField.ACCEPTED, labelKey: "restock.dateField.accepted" },
  { value: RestockDateField.CANCELLED, labelKey: "restock.dateField.cancelled" },
];
