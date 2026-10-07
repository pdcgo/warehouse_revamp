import type { ReactNode } from "react";
import { SectionShell } from "../_shells/SectionShell";

// The Billing section shell — a title, its tabs, and whichever child route is selected.
//
// It is the shared SectionShell with this section's tabs; see _shells/SectionShell for why the
// twelve legacy parent routes are one component rather than twelve.
//
export const description =
  "The Billing section — 9 tabs, each a real route.";

export type BillingSectionShellTab = "overview" | "payable-log" | "payable-payment" | "payable-team" | "receivable-log" | "receivable-payment" | "receivable-team" | "teams" | "limits";

export interface BillingSectionShellProps {
  active?: BillingSectionShellTab;
  children?: ReactNode;
}

const TABS: Array<{ key: BillingSectionShellTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "payable-log", label: "Payable log" },
  { key: "payable-payment", label: "Payable payments" },
  { key: "payable-team", label: "Who we owe" },
  { key: "receivable-log", label: "Receivable log" },
  { key: "receivable-payment", label: "Receivable payments" },
  { key: "receivable-team", label: "Who owes us" },
  { key: "teams", label: "Team balances" },
  { key: "limits", label: "Credit limits" },
];

export function BillingSectionShell({ active = "overview", children }: BillingSectionShellProps) {
  return (
    <SectionShell
      title="Billing"
      subtitle="What we owe and what we are owed, movement by movement."
      tabs={TABS}
      active={active}
      hrefFor={(key) => `/billing/${key}`}
    >
      {children}
    </SectionShell>
  );
}
