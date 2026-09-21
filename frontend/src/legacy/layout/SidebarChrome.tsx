import type { ReactNode } from "react";
import { Avatar, Box, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { LogOut, PanelLeftClose } from "lucide-react";
import { Button } from "../components/inputs/Button";
import { Tooltip } from "../components/feedback/Tooltip";
import { LimitProgress } from "../components/display/LimitProgress";
import { useSidebar } from "./SidebarContext";

// The small fixed pieces of the sidebar — the brand, the signed-in user, the limit meter, the
// collapse toggle and logout. They live in one file because each is a dozen lines and they share
// exactly one rule: EVERY ONE OF THEM HAS A COLLAPSED FORM.
//
// That is the thing a collapsed sidebar gets wrong. It is easy to narrow the container and let the
// contents overflow or disappear; the result is a strip with a logo cut in half and a user block
// showing nothing. Each piece here decides for itself what survives at icon width — usually the
// icon or the avatar, with the label moving into a tooltip.

export const logoDescription =
  "The sidebar brand. Collapsed it keeps the mark and drops the wordmark, rather than clipping the wordmark.";

export function SidebarLogo({ mark, name, addon }: { mark?: ReactNode; name?: string; addon?: string }) {
  const sidebar = useSidebar();

  return (
    <HStack gap="2" px="4" py="4" userSelect="none" data-testid="sidebar-logo">
      {mark ?? (
        <Box boxSize="6" borderRadius="l2" colorPalette="brand" bg="colorPalette.solid" flexShrink="0" />
      )}

      {!sidebar?.collapsed && (
        <HStack gap="1" lineHeight="1" minW="0">
          <Text fontSize="lg" fontWeight="black" colorPalette="brand" color="colorPalette.fg" truncate>
            {name ?? "Warehouse"}
          </Text>
          {addon && (
            <Text
              fontSize="xs"
              colorPalette="brand"
              bg="colorPalette.subtle"
              color="colorPalette.fg"
              px="1"
              py="0.5"
              borderRadius="sm"
            >
              {addon}
            </Text>
          )}
        </HStack>
      )}
    </HStack>
  );
}

export const userDescription =
  "The signed-in user. Collapsed it keeps the avatar — which is the part that identifies the account at a glance — and moves the name into a tooltip.";

export function SidebarUser({
  name,
  roleLabel,
  imageUrl,
}: {
  name?: string;
  roleLabel?: string;
  imageUrl?: string;
}) {
  const sidebar = useSidebar();
  const collapsed = sidebar?.collapsed ?? false;

  return (
    <Tooltip content={collapsed ? name : undefined} placement="right">
      <HStack
        gap="2"
        px={collapsed ? "0" : "4"}
        py="4"
        justify={collapsed ? "center" : undefined}
        data-testid="sidebar-user"
      >
        <Avatar.Root size="sm" flexShrink="0">
          {/* Initials, not a silhouette: most accounts have no photo, and a column of identical grey
              heads carries no information. */}
          <Avatar.Fallback name={name} />
          {imageUrl && <Avatar.Image src={imageUrl} alt={name} />}
        </Avatar.Root>

        {!collapsed && (
          <Stack gap="0" minW="0">
            <Text fontWeight="bold" lineHeight="short" truncate>
              {name ?? "—"}
            </Text>
            <Text fontSize="xs" color="fg.muted" truncate>
              {roleLabel ?? "no role"}
            </Text>
          </Stack>
        )}
      </HStack>
    </Tooltip>
  );
}

export const limitDescription =
  "The credit-limit meter in the sidebar — an always-visible warning that ordering is about to stop. Collapsed it keeps the bar, because the bar is the warning.";

export function SidebarLimit({
  unpaid,
  threshold,
  onClick,
}: {
  unpaid: bigint;
  threshold: bigint;
  onClick?(): void;
}) {
  const sidebar = useSidebar();

  // No limit configured means nothing to warn about — the meter is absent rather than empty.
  if (threshold <= 0n) return null;

  return (
    <Box
      px={sidebar?.collapsed ? "2" : "4"}
      py="3"
      borderYWidth="1px"
      cursor={onClick ? "pointer" : undefined}
      _hover={onClick ? { bg: "bg.muted" } : undefined}
      onClick={onClick}
      data-testid="sidebar-limit"
    >
      {/* showValue is dropped when collapsed — the numbers would not fit, but the coloured bar
          still says "close to the ceiling", which is the whole message. */}
      <LimitProgress unpaid={unpaid} threshold={threshold} showValue={!sidebar?.collapsed} />
    </Box>
  );
}

export const collapseDescription =
  "The desktop collapse toggle. Hidden on mobile, where the sidebar is a drawer and collapsing it means nothing.";

export function SidebarCollapseToggle() {
  const sidebar = useSidebar();

  return (
    <Tooltip content={sidebar?.collapsed ? "Show menu" : undefined} placement="right">
      <HStack
        // Mobile has a drawer, not a collapsed rail, so this control has no meaning there.
        hideBelow="md"
        gap="1.5"
        px="2"
        py="2"
        borderTopWidth="1px"
        cursor="pointer"
        color="fg.muted"
        fontSize="sm"
        justify="center"
        userSelect="none"
        _hover={{ color: "fg" }}
        onClick={sidebar?.toggleCollapsed}
        data-testid="sidebar-collapse"
        aria-label={sidebar?.collapsed ? "Show menu" : "Hide menu"}
        aria-expanded={!sidebar?.collapsed}
      >
        <Icon
          as={PanelLeftClose}
          boxSize="5"
          transition="transform 300ms"
          transform={sidebar?.collapsed ? "rotate(180deg)" : undefined}
        />
        {!sidebar?.collapsed && <Text>Hide menu</Text>}
      </HStack>
    </Tooltip>
  );
}

export const logoutDescription =
  "Sign out. Collapsed it becomes an icon with a tooltip rather than disappearing — the way out must not be the thing that gets hidden.";

export function SidebarLogout({ onLogout }: { onLogout?(): void }) {
  const sidebar = useSidebar();

  return (
    <Box px="2" py="2">
      <Tooltip content={sidebar?.collapsed ? "Sign out" : undefined} placement="right">
        <Button
          tone="plain"
          variant="ghost"
          icon={LogOut}
          w="full"
          justifyContent={sidebar?.collapsed ? "center" : "flex-start"}
          onClick={onLogout}
          aria-label="Sign out"
          data-testid="sidebar-logout"
        >
          {!sidebar?.collapsed && "Sign out"}
        </Button>
      </Tooltip>
    </Box>
  );
}
