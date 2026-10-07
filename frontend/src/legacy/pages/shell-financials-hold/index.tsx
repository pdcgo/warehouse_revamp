import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Held funds section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Held funds section — 2 tabs, each a real route.";

export type FinancialsHoldSectionShellTab = "shop" | "team";

export interface FinancialsHoldSectionShellProps {
  active?: FinancialsHoldSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: FinancialsHoldSectionShellTab; label: string }> = [
  { key: "shop", label: "By shop" },
  { key: "team", label: "By team" },
];

export function FinancialsHoldSectionShell({ active = "shop", children }: FinancialsHoldSectionShellProps) {
  return (
    <SectionShell
      title="Held funds"
      subtitle="Money a marketplace has taken but not released."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/financials/hold/${key}`}
    >
      {children}
    </SectionShell>
  );
}
