import { Tabs as ArkTabs } from "@ark-ui/react";
import { cn } from "./cn";

// The app's Tabs, replacing Chakra's — a styled Ark UI Tabs (roving focus, aria-selected, arrow-key
// nav). Same part names (Root/List/Trigger/Content), so migrating is an import swap. The active
// trigger carries `data-selected`; content panels mount lazily via Ark's own machine.
function Root({ className, ...p }: ArkTabs.RootProps) {
  return <ArkTabs.Root className={cn("flex flex-col", className)} {...p} />;
}

function List({ className, ...p }: ArkTabs.ListProps) {
  return <ArkTabs.List className={cn("flex gap-1 border-b border-line", className)} {...p} />;
}

function Trigger({ className, ...p }: ArkTabs.TriggerProps) {
  return (
    <ArkTabs.Trigger
      className={cn(
        "-mb-px cursor-pointer border-b-2 border-transparent px-3 pt-1 pb-2 text-sm font-medium text-fg-muted outline-none transition-colors hover:text-fg",
        "data-[selected]:border-accent data-[selected]:text-accent-fg",
        className,
      )}
      {...p}
    />
  );
}

function Content({ className, ...p }: ArkTabs.ContentProps) {
  return <ArkTabs.Content className={cn("pt-4 outline-none", className)} {...p} />;
}

function Indicator({ className, ...p }: ArkTabs.IndicatorProps) {
  return <ArkTabs.Indicator className={className} {...p} />;
}

export const Tabs = { Root, List, Trigger, Content, Indicator };
