import type { ComponentProps } from "react";
import { Popover as ArkPopover, Portal } from "@ark-ui/react";
import { cn } from "./cn";

// The app's Popover, replacing Chakra's — a styled Ark UI Popover (positioning, focus, dismissal).
// Same part names as Chakra. Render Content WITHOUT wrapping it in <Portal> to keep it inline (the
// CategorySelect-inside-a-modal case, Chakra's portalled={false}). Re-exports Portal.
const Root = ArkPopover.Root;
const Trigger = ArkPopover.Trigger;
const Anchor = ArkPopover.Anchor;
const CloseTrigger = ArkPopover.CloseTrigger;

function Positioner({ className, ...p }: ComponentProps<typeof ArkPopover.Positioner>) {
  return <ArkPopover.Positioner className={cn("z-50", className)} {...p} />;
}

function Content({ className, ...p }: ComponentProps<typeof ArkPopover.Content>) {
  return (
    <ArkPopover.Content
      className={cn(
        "rounded-card border border-line bg-surface p-2 shadow-pop outline-none",
        className,
      )}
      {...p}
    />
  );
}

function Title({ className, ...p }: ComponentProps<typeof ArkPopover.Title>) {
  return <ArkPopover.Title className={cn("text-sm font-semibold text-fg", className)} {...p} />;
}

function Description({ className, ...p }: ComponentProps<typeof ArkPopover.Description>) {
  return <ArkPopover.Description className={cn("text-sm text-fg-muted", className)} {...p} />;
}

export const Popover = { Root, Trigger, Anchor, Positioner, Content, Title, Description, CloseTrigger };
export { Portal };
