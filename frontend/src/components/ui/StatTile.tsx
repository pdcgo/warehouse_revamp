import type { ReactNode } from "react";
import { cn } from "./cn";

// The app's stat tile — the uppercase micro-label over a big tabular value, with an optional caption.
// The recurring `.stat` molecule from the mocks (Overview, list-page summary rows).
export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Tint the value, e.g. "text-warn" for an at-risk figure. */
  valueClassName?: string;
}

export function StatTile({ label, value, sub, valueClassName }: StatTileProps) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-subtle">
        {label}
      </div>
      <div className={cn("mt-1 text-[21px] font-semibold [font-variant-numeric:tabular-nums]", valueClassName)}>
        {value}
      </div>
      {sub != null && <div className="mt-0.5 text-xs text-fg-muted">{sub}</div>}
    </div>
  );
}
