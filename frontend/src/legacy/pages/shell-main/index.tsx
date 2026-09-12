import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Overview section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
// ⚠ ONE TAB TODAY. It keeps the shell anyway: the section exists as a route in its own right, and
// a lone tab that later becomes two should not require the screen to be rebuilt as a tabbed one.
export const description =
  "The Overview section — 1 tab, each a real route.";

export type MainSectionShellTab = "dashboard";

export interface MainSectionShellProps {
  active?: MainSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: MainSectionShellTab; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
];

export function MainSectionShell({ active = "dashboard", children }: MainSectionShellProps) {
  return (
    <SectionShell
      title="Overview"
      subtitle="The older dashboard section, kept for reference."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/main/${key}`}
    >
      {children}
    </SectionShell>
  );
}
