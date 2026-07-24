import type { ComponentProps, HTMLAttributes } from "react";
import { Combobox as ArkCombobox, Portal, useListCollection } from "@ark-ui/react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "./cn";

// The app's Combobox, replacing Chakra's — a styled Ark UI Combobox (same Zag machine, so the #131
// display-text-from-value remount trap, keyboard nav, aria-activedescendant and portalled listbox all
// behave identically). Same part names as Chakra, plus IndicatorGroup (a div; Ark has none), so the
// 7 pickers migrate as import swaps. Re-exports useListCollection + Portal.

// Root/List are logic/context — re-exported unstyled so their generics survive.
const Root = ArkCombobox.Root;
const List = ArkCombobox.List;

function Label({ className, ...p }: ComponentProps<typeof ArkCombobox.Label>) {
  return <ArkCombobox.Label className={cn("text-sm font-medium text-fg", className)} {...p} />;
}

function Control({ className, ...p }: ComponentProps<typeof ArkCombobox.Control>) {
  return <ArkCombobox.Control className={cn("relative flex w-full items-center", className)} {...p} />;
}

function Input({ className, ...p }: ComponentProps<typeof ArkCombobox.Input>) {
  return (
    <ArkCombobox.Input
      className={cn(
        "h-8 w-full rounded-control border border-line-strong bg-surface pl-3 pr-14 text-sm text-fg placeholder:text-fg-subtle outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...p}
    />
  );
}

// Groups the clear + open affordances at the input's right edge (Chakra's IndicatorGroup slot).
function IndicatorGroup({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("absolute right-1 flex items-center gap-0.5", className)} {...p} />
  );
}

const triggerBtn =
  "inline-flex size-6 items-center justify-center rounded-control text-fg-subtle outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent";

// Renders its own X — matches Chakra's self-closing usage. Ark hides it while the field is empty.
function ClearTrigger({ className, ...p }: ComponentProps<typeof ArkCombobox.ClearTrigger>) {
  return (
    <ArkCombobox.ClearTrigger className={cn(triggerBtn, className)} {...p}>
      <X className="size-4" />
    </ArkCombobox.ClearTrigger>
  );
}

function Trigger({ className, ...p }: ComponentProps<typeof ArkCombobox.Trigger>) {
  return (
    <ArkCombobox.Trigger className={cn(triggerBtn, className)} {...p}>
      <ChevronDown className="size-4" />
    </ArkCombobox.Trigger>
  );
}

function Positioner({ className, ...p }: ComponentProps<typeof ArkCombobox.Positioner>) {
  return <ArkCombobox.Positioner className={cn("z-50", className)} {...p} />;
}

function Content({ className, ...p }: ComponentProps<typeof ArkCombobox.Content>) {
  return (
    <ArkCombobox.Content
      className={cn(
        "max-h-64 min-w-[var(--reference-width)] overflow-auto rounded-card border border-line bg-surface p-1 shadow-pop outline-none",
        className,
      )}
      {...p}
    />
  );
}

// Item is generic over the collection item; wrap loosely so `item={...}` still type-checks.
function Item({ className, ...p }: ComponentProps<typeof ArkCombobox.Item>) {
  return (
    <ArkCombobox.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-sm text-fg outline-none data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium",
        className,
      )}
      {...p}
    />
  );
}

function ItemText({ className, ...p }: ComponentProps<typeof ArkCombobox.ItemText>) {
  return <ArkCombobox.ItemText className={cn("flex-1", className)} {...p} />;
}

function ItemIndicator({ className, ...p }: ComponentProps<typeof ArkCombobox.ItemIndicator>) {
  return (
    <ArkCombobox.ItemIndicator className={cn("ml-auto", className)} {...p}>
      <Check className="size-4 text-accent" />
    </ArkCombobox.ItemIndicator>
  );
}

function ItemGroup({ className, ...p }: ComponentProps<typeof ArkCombobox.ItemGroup>) {
  return <ArkCombobox.ItemGroup className={className} {...p} />;
}

function ItemGroupLabel({ className, ...p }: ComponentProps<typeof ArkCombobox.ItemGroupLabel>) {
  return (
    <ArkCombobox.ItemGroupLabel
      className={cn(
        "px-2 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle",
        className,
      )}
      {...p}
    />
  );
}

function Empty({ className, ...p }: ComponentProps<typeof ArkCombobox.Empty>) {
  return (
    <ArkCombobox.Empty
      className={cn("flex items-center justify-center px-2 py-6 text-sm text-fg-muted", className)}
      {...p}
    />
  );
}

export const Combobox = {
  Root,
  List,
  Label,
  Control,
  Input,
  IndicatorGroup,
  ClearTrigger,
  Trigger,
  Positioner,
  Content,
  Item,
  ItemText,
  ItemIndicator,
  ItemGroup,
  ItemGroupLabel,
  Empty,
};
export { Portal, useListCollection };
