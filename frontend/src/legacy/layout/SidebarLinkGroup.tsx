import { useEffect, useMemo, useState } from "react";
import { Box, Icon, IconButton, Stack, Text } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useLocation } from "react-router-dom";
import { ToneBadge } from "../components/badges/ToneBadge";
import { useSidebar } from "./SidebarContext";
import { SidebarLink, isCurrent, type SidebarLinkItem } from "./SidebarLink";

// groupSubmenu buckets a submenu by its items' `group` heading, keeping first-appearance order.
//
// Hidden items are dropped BEFORE bucketing, so a heading whose every item is hidden does not render
// as a lone heading over nothing — which reads as a section that failed to load.
function groupSubmenu(items: SidebarLinkItem[]): Array<{ name?: string; items: SidebarLinkItem[] }> {
  const order: string[] = [];
  const buckets = new Map<string, { name?: string; items: SidebarLinkItem[] }>();

  for (const item of items) {
    if (item.hidden) continue;

    const key = item.group ?? "";
    if (!buckets.has(key)) {
      buckets.set(key, { name: item.group, items: [] });
      order.push(key);
    }
    buckets.get(key)!.items.push(item);
  }

  return order.map((key) => buckets.get(key)!);
}

export const description =
  "A titled section of sidebar links, where an item with a submenu expands in place. ONE submenu is open at a time across the whole sidebar, and the one containing the current route opens itself.";

export interface SidebarLinkGroupProps {
  name?: string;
  beta?: boolean;
  items: SidebarLinkItem[];
  // Which submenu is open, lifted so the whole sidebar shares ONE — see the note in Sidebar.
  openKey?: string;
  onOpenChange?(key: string | undefined): void;
  onNavigate?(): void;
}

export function SidebarLinkGroup({
  name,
  beta,
  items,
  openKey,
  onOpenChange,
  onNavigate,
}: SidebarLinkGroupProps) {
  const sidebar = useSidebar();
  const collapsed = sidebar?.collapsed ?? false;

  return (
    <Stack gap="1" px={collapsed ? "1" : "2"} py="2" data-testid="sidebar-group">
      {/* The section heading is the first thing to go when the sidebar narrows: at icon width it
          would wrap to three lines or clip to meaninglessness. */}
      {name && !collapsed && (
        <Text fontSize="xs" color="fg.subtle" px="2" pb="1" display="flex" alignItems="center" gap="1.5">
          {name}
          {beta && <ToneBadge tone="active">BETA</ToneBadge>}
        </Text>
      )}

      {items.map((item) =>
        item.submenu?.length && !collapsed ? (
          <ExpandableItem
            key={item.name}
            item={item}
            open={openKey === item.name}
            onOpenChange={onOpenChange}
            onNavigate={onNavigate}
          />
        ) : (
          <SidebarLink key={item.name} item={item} onNavigate={onNavigate} />
        ),
      )}
    </Stack>
  );
}

function ExpandableItem({
  item,
  open,
  onOpenChange,
  onNavigate,
}: {
  item: SidebarLinkItem;
  open: boolean;
  onOpenChange?(key: string | undefined): void;
  onNavigate?(): void;
}) {
  const { pathname } = useLocation();

  // "Is the current route anywhere under this parent" — the parent's own routes plus every child's.
  const active = useMemo(
    () => isCurrent(pathname, item) || (item.submenu ?? []).some((sub) => isCurrent(pathname, sub)),
    [pathname, item],
  );

  // Tracks the last route we auto-opened for, so a MANUAL close is not immediately undone by this
  // effect on the next unrelated re-render. Without it a parent containing the current route could
  // never be collapsed by hand.
  const [autoOpenedFor, setAutoOpenedFor] = useState<string>();

  useEffect(() => {
    if (!active || autoOpenedFor === pathname) return;

    setAutoOpenedFor(pathname);
    onOpenChange?.(item.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pathname, item.name]);

  const groups = groupSubmenu(item.submenu ?? []);

  return (
    <Box>
      <Box position="relative">
        <SidebarLink item={item} onNavigate={onNavigate} />

        {/* A SEPARATE control from the link, deliberately. The parent is itself a real destination,
            so clicking its name must navigate; only the chevron toggles. One element doing both is
            the sidebar that navigates when you meant to expand. */}
        <IconButton
          size="xs"
          variant="ghost"
          position="absolute"
          insetEnd="1"
          top="50%"
          transform="translateY(-50%)"
          aria-label={open ? `Collapse ${item.name}` : `Expand ${item.name}`}
          aria-expanded={open}
          data-testid={`sidebar-toggle-${item.name}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenChange?.(open ? undefined : item.name);
          }}
        >
          <Icon
            as={ChevronDown}
            boxSize="3.5"
            transition="transform 200ms"
            transform={open ? "rotate(180deg)" : undefined}
            color={active ? "colorPalette.fg" : "fg.subtle"}
            colorPalette="brand"
          />
        </IconButton>
      </Box>

      {open && (
        // Indented behind a rule, so a submenu reads as belonging to its parent rather than as more
        // top-level items that happen to sit lower.
        <Stack
          gap="1"
          ms="4"
          mt="1"
          ps="2"
          borderStartWidth="1px"
          data-testid={`sidebar-submenu-${item.name}`}
        >
          {groups.map((group, i) => (
            <Stack gap="1" key={group.name ?? i}>
              {group.name && (
                <Text
                  fontSize="2xs"
                  fontWeight="medium"
                  textTransform="uppercase"
                  letterSpacing="wide"
                  color="fg.subtle"
                  px="2"
                  pt="1"
                >
                  {group.name}
                </Text>
              )}
              {group.items.map((sub) => (
                // Never collapsed: a submenu only exists while the sidebar is expanded.
                <SidebarLink key={sub.name} item={sub} collapsed={false} onNavigate={onNavigate} />
              ))}
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}
