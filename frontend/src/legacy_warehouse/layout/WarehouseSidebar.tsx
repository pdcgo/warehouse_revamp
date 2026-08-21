import { Box, Button, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { LogOut, Warehouse } from "lucide-react";
import { SideLink } from "./SideLink";
import { UserCard, type FloorUser } from "./UserCard";
import { isCurrent, visibleGroups } from "./nav";

export interface WarehouseSidebarProps {
  pathname: string;
  user?: FloorUser;
  // Per-item counts, keyed by nav item key. Kept out of `nav.ts` because a menu definition is static
  // and a badge is live data.
  badges?: Record<string, number>;
  onNavigate?(): void;
  onSignOut?(): void;
}

export function WarehouseSidebar({ pathname, user, badges, onNavigate, onSignOut }: WarehouseSidebarProps) {
  const groups = visibleGroups(user?.roles ?? []);

  return (
    <Stack gap="0" h="full" data-testid="warehouse-sidebar">
      <HStack gap="2" px="4" py="3">
        <Icon as={Warehouse} boxSize="5" color="colorPalette.solid" colorPalette="brand" />
        <Text fontWeight="medium">Warehouse Admin</Text>
      </HStack>

      <UserCard user={user} />

      <Stack gap="0" flex="1" overflowY="auto" divideY="1px">
        {groups.map((group) => (
          <Stack key={group.key} gap="1" px="2" py="3" data-testid={`nav-group-${group.key}`}>
            <Text fontSize="2xs" color="fg.muted" px="2" textTransform="uppercase" letterSpacing="wide">
              {group.name}
            </Text>
            {group.items.map((item) => (
              <SideLink
                key={item.key}
                item={{ ...item, badge: badges?.[item.key] }}
                current={isCurrent(pathname, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </Stack>
        ))}
      </Stack>

      {/* ⚠ SIGN OUT IS A PERMANENT, VISIBLE FOOTER — not an item in an avatar menu.
          On a shared tablet, handing over to the next shift is a routine action performed many
          times a day, and burying it behind a menu on a device operated with gloves on is how a
          session ends up shared for a whole shift. */}
      <Box borderTopWidth="1px" bg="bg.subtle">
        <Button
          variant="ghost"
          colorPalette="red"
          w="full"
          justifyContent="center"
          borderRadius="0"
          onClick={onSignOut}
          data-testid="sign-out"
        >
          <Icon as={LogOut} boxSize="4" />
          Sign out
        </Button>
      </Box>
    </Stack>
  );
}
