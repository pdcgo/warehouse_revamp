import {
  Avatar,
  Box,
  Button,
  CloseButton,
  Drawer,
  Flex,
  Icon,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { LogOut } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../features/auth/AuthContext";
import { useTeam } from "../../features/team/TeamContext";
import { roleLabel } from "../../lib/roles";
import { LanguageSwitch, ThemeSwitch } from "../PreferenceSwitches";
import { activeRoute, isMenuGroup, menuFor } from "../nav";
import type { MenuEntry, MenuItem } from "../nav";

// THE MORE SHEET — the whole menu, full-screen, behind the bottom bar's last tab.
//
// It is the mobile half that THINKS (the desktop's [Sidebar] is the other one): same menu from
// nav.ts, same longest-prefix highlight — but drawn for a thumb rather than a pointer, and that
// changes two things on purpose:
//
//   | desktop sidebar                       | here                                              |
//   | ------------------------------------- | ------------------------------------------------- |
//   | groups are an ACCORDION, one open     | groups are OPEN SECTIONS — the sheet scrolls       |
//   | theme/language/sign-out in a Menu     | inline rows — a popup menu inside a sheet is a    |
//   |                                       | second layer to dismiss, on the layer that IS the |
//   |                                       | dismissal                                          |
//
// The accordion exists so a 258px column never becomes a wall of links you have to scroll past. A
// full-screen sheet has no such shortage — and there, collapsing costs a tap on every single
// navigation, which is the opposite of the trade the accordion was making.
export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { identity, logout } = useAuth();
  const { current } = useTeam();
  const { t } = useTranslation();
  const location = useLocation();

  const menu = menuFor(current?.teamType, current?.role);
  const activeTo = activeRoute(menu, location.pathname);

  // One row. EVERY link closes the sheet itself rather than leaving it to a route effect: tapping
  // the screen you are already on changes no route, and a sheet that stays open after a deliberate
  // tap reads as the tap not having registered.
  const row = (item: MenuItem) => {
    const active = item.to === activeTo;

    return (
      <Link key={item.to} to={item.to} onClick={onClose} aria-current={active ? "page" : undefined}>
        <Flex
          align="center"
          gap="3"
          w="full"
          rounded="md"
          px="3"
          // 44px of height, which is the smallest target a finger hits reliably — the desktop
          // sidebar's `py="2"` rows are sized for a pointer that lands where it is aimed.
          py="2.5"
          fontSize="sm"
          fontWeight="medium"
          bg={active ? "brand.solid" : "transparent"}
          color={active ? "brand.contrast" : "fg.muted"}
        >
          <Icon as={item.icon} boxSize="4" flexShrink={0} />
          <Text>{t(item.label)}</Text>
        </Flex>
      </Link>
    );
  };

  // A group is a labelled SECTION with all of its children showing — see the note above.
  const section = (entry: MenuEntry) => {
    if (!isMenuGroup(entry)) {
      return row(entry);
    }

    return (
      <Stack key={entry.label} gap="1" pt="2" data-testid={`sheet-section-${entry.label}`}>
        <Flex align="center" gap="2" px="3" color="fg.subtle">
          <Icon as={entry.icon} boxSize="3.5" flexShrink={0} />
          <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide">
            {t(entry.label)}
          </Text>
        </Flex>
        {entry.children.map((child) => row(child))}
      </Stack>
    );
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) {
          onClose();
        }
      }}
      // FROM THE BOTTOM, because that is the edge the trigger is on — a sheet that flies in from the
      // opposite side of the screen from the tab that opened it breaks the connection between them. A DRAWER, not the
      // whole screen (`the-phone-opens-its-panels-from-the-bottom`): the page stays visible above it.
      placement="bottom"
    >
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content roundedTop="l3" maxH="90dvh" data-testid="menu-sheet">
            {/* THE ACCOUNT IS THE HEADER (owner, `the-more-sheet-starts-with-the-account`) — who is signed in, and as
                what here. The workspace is NOT in this sheet: the top bar's team chip is where a phone switches team. */}
            <Drawer.Header
              display="flex"
              alignItems="center"
              gap="2.5"
              borderBottomWidth="1px"
              borderColor="border"
              px="card"
              py="3"
              data-testid="menu-sheet-account"
            >
              {/* A dialog needs an accessible name; the header's visible text is a person, not a title. */}
              <Drawer.Title srOnly>{t("shell.menu")}</Drawer.Title>

              <Avatar.Root size="sm" colorPalette="brand">
                <Avatar.Fallback name={identity?.username} />
              </Avatar.Root>
              <Box flex="1" minW="0">
                <Text fontSize="sm" fontWeight="semibold" truncate data-testid="current-user">
                  {identity?.username}
                </Text>
                <Text fontSize="xs" color="fg.subtle" truncate>
                  {roleLabel(current?.role)}
                </Text>
              </Box>
              <Drawer.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Drawer.CloseTrigger>
            </Drawer.Header>

            <Drawer.Body px="card" py="2">
              {/* ⚠ NOT the first `navigation` landmark on this screen — the bottom bar is, and it is
                  earlier in the DOM. That is the right order: the bar is the primary navigation and
                  this is the overflow. */}
              <Stack as="nav" gap="1">
                {menu.map((entry) => section(entry))}
              </Stack>
            </Drawer.Body>

            {/* THE PREFERENCES AND THE WAY OUT — the person's name heads the sheet. The desktop puts these behind a
                popup menu on the user card; inside a sheet that would be a layer on a layer, so they are laid out
                flat and reachable in one tap each. */}
            <Drawer.Footer
              borderTopWidth="1px"
              borderColor="border"
              px="card"
              py="3"
              pb="calc(env(safe-area-inset-bottom) + var(--chakra-spacing-3))"
              display="block"
            >
              <Stack gap="2.5">
                {/* TWO SWITCHES (owner: *"di tema … buat jadi switch icon matahari bulan, untuk bahasa switch ID dan EN"*,
                    `the-more-sheet-switches-theme-and-language`) — each a thumb that carries what is on: ☀ or ☾, ID or EN.
                    The same switches the desktop's account menu draws (PreferenceSwitches). */}
                <Flex align="center" justify="space-between" gap="3">
                  <Text fontSize="sm" color="fg.muted">
                    {t("menu.theme")}
                  </Text>
                  <ThemeSwitch />
                </Flex>

                <Flex align="center" justify="space-between" gap="3">
                  <Text fontSize="sm" color="fg.muted">
                    {t("menu.language")}
                  </Text>
                  <LanguageSwitch />
                </Flex>

                <Button
                  variant="outline"
                  colorPalette="error"
                  w="full"
                  data-testid="sign-out"
                  onClick={() => void logout()}
                >
                  <Icon as={LogOut} boxSize="4" />
                  {t("menu.signOut")}
                </Button>
              </Stack>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
