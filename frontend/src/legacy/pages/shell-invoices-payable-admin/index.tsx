import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Payable — all teams section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Payable — all teams section — 4 tabs, each a real route.";

export type InvoicePayableAdminSectionShellTab = "list" | "day-history" | "paid-history" | "paid-request";

export interface InvoicePayableAdminSectionShellProps {
  active?: InvoicePayableAdminSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: InvoicePayableAdminSectionShellTab; label: string }> = [
  { key: "list", label: "Invoices" },
  { key: "day-history", label: "By day" },
  { key: "paid-history", label: "Payments" },
  { key: "paid-request", label: "Payment requests" },
];

export function InvoicePayableAdminSectionShell({ active = "list", children }: InvoicePayableAdminSectionShellProps) {
  return (
    <SectionShell
      title="Payable — all teams"
      subtitle="Every team's supplier invoices, in one place."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/invoices/payable-admin/${key}`}
    >
      {children}
    </SectionShell>
  );
}
