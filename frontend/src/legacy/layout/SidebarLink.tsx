import type { ElementType } from "react";
import { Badge, Box, HStack, Icon, Text } from "@chakra-ui/react";
import { NavLink, useLocation } from "react-router-dom";
import type { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { Tooltip } from "../components/feedback/Tooltip";
import { useSidebar } from "./SidebarContext";

export interface SidebarLinkItem {
  href: string;
  name: string;
  icon: ElementType;
  // Extra path prefixes that should ALSO mark this link current — a list item staying highlighted
  // while you are on one of its detail routes.
  matches?: string[];
  // Show only to these roles. UI gating only; the interceptor is the real boundary.
  roles?: Role[];
  hidden?: boolean;
  // A pending count — the number of things waiting on this screen.
  count?: number;
  // Small corner markers for recently-shipped / in-progress screens.
  isNew?: boolean;
  isBeta?: boolean;
  submenu?: SidebarLinkItem[];
  // A heading this item sits under inside a submenu ("Payable", "Receivable").
  group?: string;
}

// isCurrent answers "am I on this link's screen", by LONGEST PREFIX rather than by equality.
//
// Equality would un-highlight the nav the moment you opened a detail page, which is exactly when the
// reader most needs to know where they are. The root "/" is special-cased: as a prefix it matches
// everything, so it only counts on an exact match.
export function isCurrent(pathname: string, item: SidebarLinkItem): boolean {
  const candidates = [item.href, ...(item.matches ?? [])];

  return candidates.some((path) => {
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(`${path}/`);
  });
}

// A count of 100 or more is shown as "99+".
//
// Not cosmetic: the badge is a fixed-size circle sized for two digits, and a four-digit count either
// bursts it or shrinks the text to unreadable. Past 99 the exact number has stopped being actionable
// anyway — "a lot" is the whole message.
function countLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export const description =
  "A sidebar nav link: icon, name, an optional pending count, and new/beta markers. Marks itself current by longest-prefix match, so it stays highlighted on a detail route. Collapses to an icon with a tooltip.";

export interface SidebarLinkProps {
  item: SidebarLinkItem;
  // Forced collapse, overriding the sidebar context. Submenu children are never collapsed.
  collapsed?: boolean;
  onNavigate?(): void;
}

export function SidebarLink({ item, collapsed, onNavigate }: SidebarLinkProps) {
  const sidebar = useSidebar();
  const { pathname } = useLocation();

  const isCollapsed = collapsed ?? sidebar?.collapsed ?? false;

  if (item.hidden) return null;
  // Role gating. No `roles` means "everyone"; a role list with no viewer role means "nobody yet",
  // which is the right answer while the session is still loading — better a missing link for a beat
  // than one that flashes and disappears.
  if (item.roles?.length && (sidebar?.role === undefined || !item.roles.includes(sidebar.role))) {
    return null;
  }

  const current = isCurrent(pathname, item);
  const hasCount = (item.count ?? 0) > 0;
  const marker = item.isNew ? "new" : item.isBeta ? "beta" : undefined;

  return (
    // The name only becomes a tooltip once the label is gone. A tooltip repeating a visible label is
    // noise that fires on the way to somewhere else.
    <Tooltip content={isCollapsed ? item.name : undefined} placement="right">
      <HStack
        asChild
        gap="2"
        px="2"
        py={isCollapsed ? "2" : "1"}
        borderRadius="l2"
        position="relative"
        transition="background-color 150ms, color 150ms"
        colorPalette="brand"
        bg={current ? "colorPalette.subtle" : undefined}
        color={current ? "colorPalette.fg" : "fg.muted"}
        fontWeight={current ? "semibold" : "normal"}
        _hover={{ bg: current ? "colorPalette.subtle" : "bg.muted", color: current ? undefined : "fg" }}
        justifyContent={isCollapsed ? "center" : undefined}
      >
        <NavLink
          to={item.href}
          onClick={onNavigate}
          // aria-current is what a screen reader uses to announce "you are here". The visual
          // highlight alone says it only to people who can see it.
          aria-current={current ? "page" : undefined}
          data-testid={`sidebar-link-${item.name}`}
          data-current={current ? "true" : undefined}
        >
          <Icon as={item.icon} boxSize="4" flexShrink="0" />

          {!isCollapsed && (
            <Text flex="1" lineHeight="short" truncate>
              {item.name}
            </Text>
          )}

          {hasCount && (
            <Badge
              colorPalette="brand"
              variant="solid"
              borderRadius="full"
              // Collapsed there is no room in the row, so the count moves to the icon's corner —
              // still visible, which is the point of a pending count.
              position={isCollapsed ? "absolute" : undefined}
              top={isCollapsed ? "0" : undefined}
              insetEnd={isCollapsed ? "0" : undefined}
              fontSize={item.count! > 99 ? "2xs" : "xs"}
              data-testid={`sidebar-count-${item.name}`}
            >
              {countLabel(item.count!)}
            </Badge>
          )}

          {marker && !hasCount && (
            <Box
              as="span"
              px={isCollapsed ? "0" : "1.5"}
              borderRadius="full"
              bg="colorPalette.solid"
              color="colorPalette.contrast"
              fontSize="2xs"
              lineHeight="1.4"
              position={isCollapsed ? "absolute" : undefined}
              top={isCollapsed ? "0" : undefined}
              insetEnd={isCollapsed ? "0" : undefined}
              data-testid={`sidebar-marker-${item.name}`}
            >
              {/* Collapsed there is only room for a letter. */}
              {isCollapsed ? marker[0] : marker}
            </Box>
          )}
        </NavLink>
      </HStack>
    </Tooltip>
  );
}
