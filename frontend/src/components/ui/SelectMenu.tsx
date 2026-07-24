import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { Select as ArkSelect, createListCollection } from "@ark-ui/react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./cn";

// The listbox renders INLINE, not portalled — a portalled popup is inert inside an open modal dialog
// (see ui/Combobox). floating-ui still positions it against the trigger. Keeps `<Portal>` call sites.
function Portal({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

// The app's COMPOSABLE Select, replacing Chakra's `Select` (the listbox one, not `NativeSelect`) —
// a styled Ark UI Select (same Zag machine), same part names as Chakra, so the enum pickers that
// were composable Selects (PaymentType/Marketplace/ExpenseKind/TeamType) migrate by an import swap.
// It looks and keyboard-behaves like the rest of the form (a native <select> does not). For a native
// dropdown use ui/Select; for a searchable, server-backed picker use ui/Combobox. Re-exports
// createListCollection + Portal, and adds IndicatorGroup (a div; Ark has none), matching Chakra.
const Root = ArkSelect.Root;
const HiddenSelect = ArkSelect.HiddenSelect;
const ItemGroup = ArkSelect.ItemGroup;

function Label({ className, ...p }: ComponentProps<typeof ArkSelect.Label>) {
  return <ArkSelect.Label className={cn("text-sm font-medium text-fg", className)} {...p} />;
}

function Control({ className, ...p }: ComponentProps<typeof ArkSelect.Control>) {
  return <ArkSelect.Control className={cn("relative w-full", className)} {...p} />;
}

function Trigger({ className, ...p }: ComponentProps<typeof ArkSelect.Trigger>) {
  return (
    <ArkSelect.Trigger
      className={cn(
        "flex h-8 w-full items-center justify-between gap-2 rounded-control border border-line-strong bg-surface pl-3 pr-8 text-left text-sm text-fg outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 data-[placeholder-shown]:text-fg-subtle",
        className,
      )}
      {...p}
    />
  );
}

function ValueText({ className, ...p }: ComponentProps<typeof ArkSelect.ValueText>) {
  return <ArkSelect.ValueText className={cn("truncate", className)} {...p} />;
}

function IndicatorGroup({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2", className)}
      {...p}
    />
  );
}

function Indicator({ className, ...p }: ComponentProps<typeof ArkSelect.Indicator>) {
  return (
    <ArkSelect.Indicator className={cn("text-fg-subtle", className)} {...p}>
      <ChevronDown className="size-4" />
    </ArkSelect.Indicator>
  );
}

function Positioner({ className, ...p }: ComponentProps<typeof ArkSelect.Positioner>) {
  // z-[60] > the Dialog positioner's z-50, so a select opened inside a modal renders above it.
  return <ArkSelect.Positioner className={cn("z-[60]", className)} {...p} />;
}

function Content({ className, ...p }: ComponentProps<typeof ArkSelect.Content>) {
  return (
    <ArkSelect.Content
      className={cn(
        "max-h-64 min-w-[var(--reference-width)] overflow-auto rounded-card border border-line bg-surface p-1 shadow-pop outline-none",
        className,
      )}
      {...p}
    />
  );
}

function Item({ className, ...p }: ComponentProps<typeof ArkSelect.Item>) {
  return (
    <ArkSelect.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-sm text-fg outline-none data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium",
        className,
      )}
      {...p}
    />
  );
}

function ItemText({ className, ...p }: ComponentProps<typeof ArkSelect.ItemText>) {
  return <ArkSelect.ItemText className={cn("flex-1", className)} {...p} />;
}

function ItemIndicator({ className, ...p }: ComponentProps<typeof ArkSelect.ItemIndicator>) {
  return (
    <ArkSelect.ItemIndicator className={cn("ml-auto", className)} {...p}>
      <Check className="size-4 text-accent" />
    </ArkSelect.ItemIndicator>
  );
}

export const Select = {
  Root,
  HiddenSelect,
  Label,
  Control,
  Trigger,
  ValueText,
  IndicatorGroup,
  Indicator,
  Positioner,
  Content,
  Item,
  ItemText,
  ItemIndicator,
  ItemGroup,
};
export { Portal, createListCollection };
