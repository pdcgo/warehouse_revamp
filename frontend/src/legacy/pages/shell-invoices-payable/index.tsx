import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Payable section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Payable section — 4 tabs, each a real route.";

export type InvoicePayableSectionShellTab = "list" | "day-history" | "paid-history" | "paid-request";

export interface InvoicePayableSectionShellProps {
  active?: InvoicePayableSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: InvoicePayableSectionShellTab; label: string }> = [
  { key: "list", label: "Invoices" },
  { key: "day-history", label: "By day" },
  { key: "paid-history", label: "Payments" },
  { key: "paid-request", label: "Payment requests" },
];

export function InvoicePayableSectionShell({ active = "list", children }: InvoicePayableSectionShellProps) {
  return (
    <SectionShell
      title="Payable"
      subtitle="Invoices a supplier has issued to us."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/invoices/payable/${key}`}
    >
      {children}
    </SectionShell>
  );
}
