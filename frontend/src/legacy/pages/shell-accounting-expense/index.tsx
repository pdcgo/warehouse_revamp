import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Expenses section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Expenses section — 2 tabs, each a real route.";

export type AccountingExpenseSectionShellTab = "list" | "overview";

export interface AccountingExpenseSectionShellProps {
  active?: AccountingExpenseSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: AccountingExpenseSectionShellTab; label: string }> = [
  { key: "list", label: "All expenses" },
  { key: "overview", label: "By category" },
];

export function AccountingExpenseSectionShell({ active = "list", children }: AccountingExpenseSectionShellProps) {
  return (
    <SectionShell
      title="Expenses"
      subtitle="What was spent, and what it was spent on."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/accounting/expense/${key}`}
    >
      {children}
    </SectionShell>
  );
}
