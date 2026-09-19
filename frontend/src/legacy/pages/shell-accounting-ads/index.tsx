import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Advertising section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Advertising section — 4 tabs, each a real route.";

export type AccountingAdsSectionShellTab = "list" | "daily" | "monthly" | "shop";

export interface AccountingAdsSectionShellProps {
  active?: AccountingAdsSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: AccountingAdsSectionShellTab; label: string }> = [
  { key: "list", label: "All spend" },
  { key: "daily", label: "By day" },
  { key: "monthly", label: "By month" },
  { key: "shop", label: "By shop" },
];

export function AccountingAdsSectionShell({ active = "list", children }: AccountingAdsSectionShellProps) {
  return (
    <SectionShell
      title="Advertising"
      subtitle="What the advertising cost, and what it returned."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/accounting/ads/${key}`}
    >
      {children}
    </SectionShell>
  );
}
