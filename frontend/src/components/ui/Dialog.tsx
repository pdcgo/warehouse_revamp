import type { HTMLAttributes } from "react";
import { Dialog as ArkDialog, Portal } from "@ark-ui/react";
import { cn } from "./cn";

// The app's composable Dialog, replacing Chakra's — a styled Ark UI Dialog (focus-trap, scroll-lock,
// Escape/backdrop, aria-modal) plus Header/Body/Footer div slots (Ark has no such parts). Same shape
// the form dialogs already use, so migrating one is an import swap (+ ActionTrigger → CloseTrigger).
// Portal is re-exported so call sites keep `<Portal>` around the positioner.
const Root = ArkDialog.Root;
const Trigger = ArkDialog.Trigger;
const CloseTrigger = ArkDialog.CloseTrigger;

function Backdrop({ className, ...p }: ArkDialog.BackdropProps) {
  return <ArkDialog.Backdrop className={cn("fixed inset-0 z-40 bg-black/45", className)} {...p} />;
}

function Positioner({ className, ...p }: ArkDialog.PositionerProps) {
  return (
    <ArkDialog.Positioner
      className={cn("fixed inset-0 z-50 flex items-center justify-center p-4", className)}
      {...p}
    />
  );
}

function Content({ className, ...p }: ArkDialog.ContentProps) {
  return (
    <ArkDialog.Content
      className={cn(
        "relative max-h-[90dvh] w-full max-w-md overflow-auto rounded-card border border-line bg-surface shadow-pop",
        className,
      )}
      {...p}
    />
  );
}

function Title({ className, ...p }: ArkDialog.TitleProps) {
  return <ArkDialog.Title className={cn("text-[15px] font-semibold text-fg", className)} {...p} />;
}

function Description({ className, ...p }: ArkDialog.DescriptionProps) {
  return <ArkDialog.Description className={cn("text-sm text-fg-muted", className)} {...p} />;
}

function Header({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pt-5 pb-2", className)} {...p} />;
}

function Body({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-4", className)} {...p} />;
}

function Footer({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex justify-end gap-2 px-5 pt-2 pb-5", className)} {...p} />;
}

export const Dialog = {
  Root,
  Trigger,
  Backdrop,
  Positioner,
  Content,
  Title,
  Description,
  Header,
  Body,
  Footer,
  CloseTrigger,
};
export { Portal };
