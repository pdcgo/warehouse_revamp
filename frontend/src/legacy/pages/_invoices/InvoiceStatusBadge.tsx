import { ToneBadge } from "../../components/badges/ToneBadge";
import type { Tone } from "../../components/tone";
import type { InvoiceStatus } from "../../financeFixtures";

// The standard tone for an invoice status, shared by every screen in the invoice and billing
// families.
//
// The grouping is by WHO IS WAITING:
//   error   — overdue. Somebody is late; this is the only status that needs chasing today.
//   warning — partial. Money arrived but not all of it, which is the state most likely to be
//             forgotten, because it looks handled.
//   active  — open. Issued and within terms; nothing to do yet.
//   success — paid. Closed.
//   plain   — void. Not a debt at all, and deliberately quiet so it cannot be mistaken for one.
function statusTone(status: InvoiceStatus): Tone {
  switch (status) {
    case "overdue":
      return "error";
    case "partial":
      return "warning";
    case "open":
      return "active";
    case "paid":
      return "success";
    default:
      return "plain";
  }
}

const LABEL: Record<InvoiceStatus, string> = {
  open: "Open",
  partial: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export const description =
  "An invoice status in its standard tone, grouped by WHO IS WAITING — overdue loudest, part-paid marked because it looks handled and is the one most often forgotten.";

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <ToneBadge tone={statusTone(status)} data-testid={`invoice-status-${status}`}>
      {LABEL[status]}
    </ToneBadge>
  );
}
