import { Menu as ArkMenu, Portal } from "@ark-ui/react";
import { Check } from "lucide-react";
import { cn } from "./cn";

// The app's Menu, replacing Chakra's — a styled Ark UI Menu (same Zag machine), same part names, so
// migrating a row-actions kebab or the sidebar user menu is an import swap. Ark gives focus roving,
// typeahead, Escape, and menuitemradio/aria-checked. NOTE: item click handlers are `onSelect` (Ark),
// not `onClick`. Portal is re-exported so call sites keep `<Portal>` around the positioner.
const Root = ArkMenu.Root;
const Trigger = ArkMenu.Trigger;
const ItemGroup = ArkMenu.ItemGroup;
const RadioItemGroup = ArkMenu.RadioItemGroup;
const Positioner = ArkMenu.Positioner;

function Content({ className, ...p }: ArkMenu.ContentProps) {
  return (
    <ArkMenu.Content
      className={cn(
        "z-50 min-w-44 rounded-card border border-line bg-surface p-1 shadow-pop outline-none",
        className,
      )}
      {...p}
    />
  );
}

const itemClasses =
  "flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-sm text-fg outline-none data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-fg-muted";

function Item({ className, ...p }: ArkMenu.ItemProps) {
  return <ArkMenu.Item className={cn(itemClasses, className)} {...p} />;
}

function RadioItem({ className, ...p }: ArkMenu.RadioItemProps) {
  return (
    <ArkMenu.RadioItem
      className={cn(itemClasses, "data-[state=checked]:text-accent-fg", className)}
      {...p}
    />
  );
}

function ItemGroupLabel({ className, ...p }: ArkMenu.ItemGroupLabelProps) {
  return (
    <ArkMenu.ItemGroupLabel
      className={cn(
        "px-2 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle",
        className,
      )}
      {...p}
    />
  );
}

function Separator({ className, ...p }: ArkMenu.SeparatorProps) {
  return <ArkMenu.Separator className={cn("my-1 h-px bg-line", className)} {...p} />;
}

// Renders the check when its (radio) item is selected — matches Chakra's self-closing usage.
function ItemIndicator({ className, ...p }: ArkMenu.ItemIndicatorProps) {
  return (
    <ArkMenu.ItemIndicator className={cn("ml-auto", className)} {...p}>
      <Check className="size-4 text-accent" />
    </ArkMenu.ItemIndicator>
  );
}

export const Menu = {
  Root,
  Trigger,
  Positioner,
  Content,
  Item,
  ItemGroup,
  ItemGroupLabel,
  Separator,
  RadioItemGroup,
  RadioItem,
  ItemIndicator,
};
export { Portal };
