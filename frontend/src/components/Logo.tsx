import type { HTMLAttributes } from "react";
import { cn } from "./ui/cn";

// The brand mark: a minimalist pitched-roof warehouse with a roller door. Line style (stroke,
// currentColor, no fill) so it matches the lucide icons; it inherits the surrounding `color`, which
// Logo sets to the theme accent (brand.solid). The same geometry lives in
// frontend/public/warehouse.svg (the favicon) — keep the two in sync.
export function WarehouseMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 11 12 3l10 8" />
      <path d="M4 11v10h16V11" />
      <path d="M9.5 21v-6.5h5V21" />
      <path d="M9.5 17h5" />
      <path d="M9.5 19h5" />
    </svg>
  );
}

// Logo is the mark plus the "PDC Warehouse" wordmark, laid out horizontally. Pass showWordmark
// false for a mark-only usage (e.g. a collapsed sidebar).
export function Logo({
  size = 24,
  showWordmark = true,
  className,
  ...rest
}: { size?: number; showWordmark?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-2.5 text-accent", className)} {...rest}>
      <WarehouseMark size={size} />
      {showWordmark && (
        <span className="text-lg font-semibold leading-none tracking-tight">PDC Warehouse</span>
      )}
    </div>
  );
}
