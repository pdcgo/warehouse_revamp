import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Stock section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
// ⚠ ONE TAB TODAY. It keeps the shell anyway: the section exists as a route in its own right, and
// a lone tab that later becomes two should not require the screen to be rebuilt as a tabbed one.
export const description =
  "The Stock section — 1 tab, each a real route.";

export type StockSectionShellTab = "supplier";

export interface StockSectionShellProps {
  active?: StockSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: StockSectionShellTab; label: string }> = [
  { key: "supplier", label: "Suppliers" },
];

export function StockSectionShell({ active = "supplier", children }: StockSectionShellProps) {
  return (
    <SectionShell
      title="Stock"
      subtitle="Where goods come from, and where they are."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/stock/${key}`}
    >
      {children}
    </SectionShell>
  );
}
