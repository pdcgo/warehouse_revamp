import { RestockDateField } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// THE DATES A RESTOCK HAS, offered as the range picker's field segment — one control picks both which timestamp and
// which window. In the order a restock lives them; ARRIVED is the one a supplier's lead time is measured to
// (every-status-change-is-logged).
//
// It lives in features/ because both restock lists offer it, and two copies of this list is how the two screens start
// disagreeing about what "the date" means. The labels are KEYS, resolved where `t` is.
export const RESTOCK_DATE_FIELDS: { value: RestockDateField; labelKey: string }[] = [
  { value: RestockDateField.CREATED, labelKey: "restock.dateField.created" },
  { value: RestockDateField.ARRIVED, labelKey: "restock.dateField.arrived" },
  { value: RestockDateField.ACCEPTED, labelKey: "restock.dateField.accepted" },
  { value: RestockDateField.LOST, labelKey: "restock.dateField.lost" },
  { value: RestockDateField.CANCELLED, labelKey: "restock.dateField.cancelled" },
];
