import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Balances section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Balances section — 2 tabs, each a real route.";

export type AccountingBalanceSectionShellTab = "account" | "mutation";

export interface AccountingBalanceSectionShellProps {
  active?: AccountingBalanceSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: AccountingBalanceSectionShellTab; label: string }> = [
  { key: "account", label: "Accounts" },
  { key: "mutation", label: "Mutations" },
];

export function AccountingBalanceSectionShell({ active = "account", children }: AccountingBalanceSectionShellProps) {
  return (
    <SectionShell
      title="Balances"
      subtitle="What the business owns and owes, and how it got there."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/accounting/balance/${key}`}
    >
      {children}
    </SectionShell>
  );
}
