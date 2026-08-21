import { useState, type ReactNode } from "react";
import { Box, Stack } from "@chakra-ui/react";
import { useSidebar } from "./SidebarContext";
import { SidebarLinkGroup } from "./SidebarLinkGroup";
import type { SidebarLinkItem } from "./SidebarLink";

export interface SidebarSection {
  name?: string;
  beta?: boolean;
  items: SidebarLinkItem[];
}

export const description =
  "The sidebar: a rail of link sections that collapses to icons on desktop and becomes a drawer on mobile. Exactly ONE submenu is open at a time across the whole sidebar.";

export interface SidebarProps {
  sections: SidebarSection[];
  // Pinned above the scrolling links — the logo, the user.
  header?: ReactNode;
  // Pinned below — the limit meter, the collapse toggle, logout.
  footer?: ReactNode;
}

export function Sidebar({ sections, header, footer }: SidebarProps) {
  const sidebar = useSidebar();
  const collapsed = sidebar?.collapsed ?? false;

  // ── ONE OPEN SUBMENU, FOR THE WHOLE SIDEBAR ───────────────────────────────────────────────────
  //
  // Held here rather than inside each group, because the rule is about the sidebar as a whole:
  // opening a submenu closes whichever other one was open.
  //
  // Without it, every parent a person has ever expanded stays expanded, and a sidebar with four
  // sections becomes a list forty items long that has to be SCROLLED to reach anything — which
  // defeats the point of grouping. One-at-a-time keeps the rail roughly one screen tall whatever
  // the reader has been clicking.
  const [openKey, setOpenKey] = useState<string>();

  return (
    <Box
      as="aside"
      // The nav landmark, so a screen reader can jump to it. ⚠ There must be exactly ONE of these on
      // screen — this app's own shells mount one layout or the other for that reason.
      aria-label="Main"
      width={collapsed ? "16" : { base: "full", md: "56", xl: "64" }}
      flexShrink="0"
      height="full"
      bg="bg.subtle"
      borderEndWidth="1px"
      overflowY="auto"
      overflowX="hidden"
      transition="width 200ms ease-out"
      data-testid="sidebar"
      data-collapsed={collapsed ? "true" : undefined}
    >
      <Stack gap="0" height="full">
        {header}

        {/* The links take the slack, so the header and footer stay pinned and only the link list
            scrolls. A footer that scrolls away takes the way OUT with it. */}
        <Box flex="1" minH="0">
          {sections.map((section, i) => (
            <SidebarLinkGroup
              key={section.name ?? i}
              name={section.name}
              beta={section.beta}
              items={section.items}
              openKey={openKey}
              onOpenChange={setOpenKey}
              // Navigating closes the mobile drawer. On a phone the sidebar covers the content, so
              // leaving it open would hide the page the reader just asked for.
              onNavigate={sidebar?.closeExpanded}
            />
          ))}
        </Box>

        {footer}
      </Stack>
    </Box>
  );
}
