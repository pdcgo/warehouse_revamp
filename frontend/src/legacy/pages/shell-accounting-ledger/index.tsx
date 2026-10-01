import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Ledger section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Ledger section — 3 tabs, each a real route.";

export type AccountingLedgerSectionShellTab = "account-entry" | "trial-balance" | "statistic";

export interface AccountingLedgerSectionShellProps {
  active?: AccountingLedgerSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: AccountingLedgerSectionShellTab; label: string }> = [
  { key: "account-entry", label: "Journal entries" },
  { key: "trial-balance", label: "Trial balance" },
  { key: "statistic", label: "Statistics" },
];

export function AccountingLedgerSectionShell({ active = "account-entry", children }: AccountingLedgerSectionShellProps) {
  return (
    <SectionShell
      title="Ledger"
      subtitle="The journal, and whether it is consistent."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/accounting/ledger/${key}`}
    >
      {children}
    </SectionShell>
  );
}
