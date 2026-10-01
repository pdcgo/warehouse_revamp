import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Receivable section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Receivable section — 4 tabs, each a real route.";

export type InvoiceReceivableSectionShellTab = "list" | "day-history" | "paid-history" | "paid-request";

export interface InvoiceReceivableSectionShellProps {
  active?: InvoiceReceivableSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: InvoiceReceivableSectionShellTab; label: string }> = [
  { key: "list", label: "Invoices" },
  { key: "day-history", label: "By day" },
  { key: "paid-history", label: "Payments" },
  { key: "paid-request", label: "Payment requests" },
];

export function InvoiceReceivableSectionShell({ active = "list", children }: InvoiceReceivableSectionShellProps) {
  return (
    <SectionShell
      title="Receivable"
      subtitle="Invoices we have issued to a customer."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/invoices/receivable/${key}`}
    >
      {children}
    </SectionShell>
  );
}
