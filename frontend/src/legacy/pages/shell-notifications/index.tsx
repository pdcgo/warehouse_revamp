import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Notifications section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Notifications section — 2 tabs, each a real route.";

export type NotificationSectionShellTab = "list" | "detail";

export interface NotificationSectionShellProps {
  active?: NotificationSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: NotificationSectionShellTab; label: string }> = [
  { key: "list", label: "All" },
  { key: "detail", label: "Detail" },
];

export function NotificationSectionShell({ active = "list", children }: NotificationSectionShellProps) {
  return (
    <SectionShell
      title="Notifications"
      subtitle="Alerts about stock, orders and billing."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/notifications/${key}`}
    >
      {children}
    </SectionShell>
  );
}
