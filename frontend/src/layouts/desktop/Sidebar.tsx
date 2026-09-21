import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Flex,
  Icon,
  Menu,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ChevronRight, ChevronsUpDown, LogOut } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Logo } from "../../components/chrome/Logo";
import { useAuth } from "../../features/auth/AuthContext";
import { useTeam } from "../../features/team/TeamContext";
import { LANGUAGES, useLanguage } from "../../i18n/language";
import type { Lang } from "../../i18n/language";
import { setColorMode, useColorMode } from "../../lib/colorMode";
import type { ColorMode } from "../../lib/colorMode";
import { roleLabel } from "../../lib/roles";
import { TeamSwitcher } from "../TeamSwitcher";
import { activeRoute, isMenuGroup, menuFor, owningGroupLabel } from "../nav";
import type { MenuGroup, MenuItem } from "../nav";

// THE DESKTOP SIDEBAR — brand, team switcher, navigation, and the user card at the foot.
//
// It is its own component rather than a block inside DesktopLayout because it is the half of the shell that
// THINKS: the menu it draws is computed from the current team's TYPE and the caller's ROLE, one item
// is lit by a longest-prefix match on the route, and one group at a time is open. Layout's other half
// — a top bar and an <Outlet/> — has no logic in it at all, and mixing the two put ~250 lines of
// menu behaviour in a file whose job is supposed to be the page frame.
//
// THE MENU FOLLOWS THE CURRENT TEAM — its type and your role in it. Switching team switches the whole
// app's job, and what you are allowed to do in it. (Hiding a menu item is UX only; the server's
// access interceptor is what actually stops a call — never move a check into here.)
//
// ⚠ THE DRAWER STATE IS THE CALLER'S, not ours. The thing that OPENS the sidebar on a narrow window
// is the hamburger, and the hamburger lives in the top bar (#214) — so DesktopLayout holds the
// boolean and passes it down, and the sidebar owns everything that CLOSES it: the backdrop, and
// navigating.
//
// ⚠ THE DRAWER IS FOR A DRAGGED-SMALL DESKTOP WINDOW, NOT FOR A PHONE. A handset gets
// [MobileLayout] — a bottom tab bar and a full-screen menu sheet — and never mounts this component
// at all, so nothing here should be tuned for touch at the expense of the pointer.
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { identity, logout } = useAuth();
  const { current } = useTeam();
  const { lang, setLang } = useLanguage();
  const { t } = useTranslation();
  const colorMode = useColorMode();
  const location = useLocation();

  // The nav renders at full width — the collapse-to-rail affordance the mock does not have was
  // dropped. Kept as a const so the shared navItem / TeamSwitcher signatures stay put.
  const collapsed = false;
  // Sub-menu groups are an ACCORDION (#123): at most ONE is expanded, so opening one closes the rest
  // and the sidebar never turns into a wall of links. Null = all closed.
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const menu = menuFor(current?.teamType, current?.role);
  // Both of these are computed in nav.ts, because the breadcrumb up in the top bar reads the SAME
  // match — see the note there.
  const activeTo = activeRoute(menu, location.pathname);
  const owningLabel = owningGroupLabel(menu, activeTo);

  // Open the group you are actually IN. With only one group allowed open (#123), landing on a
  // sub-menu route with every group shut would hide the very item that is highlighted. Keyed to the
  // route, so a group the user closes by hand stays closed until they navigate somewhere else.
  useEffect(() => {
    if (owningLabel) {
      setOpenGroup(owningLabel);
    }
  }, [owningLabel]);

  // Navigating closes the mobile drawer (#214): a link tap should reveal the page, not leave the
  // sidebar covering it. No-op on desktop, where the drawer is never open.
  //
  // ⚠ THE EFFECT FIRES ON THE ROUTE, AND ONLY ON THE ROUTE. Depending on `onClose` itself would make
  // an inline `() => setDrawerOpen(false)` in the caller a NEW function every render, so the effect
  // would re-run on each one and slam the drawer shut in the same frame the hamburger opened it —
  // a bug that appears only on a narrow screen and looks like the button not working. The ref keeps
  // the latest callback without putting it in the dependency list.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    onCloseRef.current();
  }, [location.pathname]);

  // One nav link row — shared by top-level items and group children. Active is decided by activeTo
  // (longest-prefix winner), NOT by the link's own prefix match, so siblings don't all light up.
  const navItem = (item: MenuItem) => {
    const active = item.to === activeTo;

    return (
      <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined}>
        <Flex
          align="center"
          gap="2.5"
          rounded="md"
          px="3"
          py="2"
          fontSize="sm"
          fontWeight="medium"
          justify={collapsed ? "center" : "flex-start"}
          bg={active ? "brand.solid" : "transparent"}
          color={active ? "brand.contrast" : "fg.muted"}
          _hover={active ? undefined : { bg: "brand.subtle", color: "brand.fg" }}
        >
          <Icon as={item.icon} boxSize="4" flexShrink={0} />
          {!collapsed && <Text>{t(item.label)}</Text>}
        </Flex>
      </Link>
    );
  };

  // A collapsible sub-menu group (#104): a clickable header (Capitalized, not uppercase) toggles its
  // children. When the whole sidebar is collapsed the group is forced open (children show as icons).
  const renderGroup = (group: MenuGroup) => {
    // A collapsed sidebar has no labels to hide behind, so every group shows its icons.
    const groupOpen = collapsed || openGroup === group.label;
    // Tint the header when the active route lives inside this group, so you can still tell which
    // group you're in when it's collapsed shut (or the whole sidebar is) and its children are hidden.
    const groupActive = group.children.some((child) => child.to === activeTo);

    return (
      <Stack key={group.label} gap="1" data-testid={`nav-group-${group.label}`}>
        <Flex
          as="button"
          align="center"
          gap="2.5"
          rounded="md"
          px="3"
          py="2"
          fontSize="sm"
          fontWeight="medium"
          color={groupActive ? "brand.fg" : "fg.muted"}
          cursor="pointer"
          justify={collapsed ? "center" : "flex-start"}
          _hover={{ bg: "brand.subtle", color: "brand.fg" }}
          data-testid={`nav-group-toggle-${group.label}`}
          // Opening a group closes whichever one was open; clicking the open one shuts it.
          onClick={() => setOpenGroup((prev) => (prev === group.label ? null : group.label))}
        >
          <Icon as={group.icon} boxSize="4" flexShrink={0} />
          {!collapsed && (
            <>
              <Text flex="1" textAlign="start">
                {t(group.label)}
              </Text>
              {/* One chevron that TURNS, rather than two that swap — swapping is a jump cut, and the
                  rotation is the same motion the drawer below is making (#123). */}
              <Icon
                as={ChevronRight}
                boxSize="4"
                flexShrink={0}
                transform={groupOpen ? "rotate(90deg)" : "rotate(0deg)"}
                transition="transform 180ms ease"
              />
            </>
          )}
        </Flex>

        {/* The drawer (#123). `grid-template-rows: 0fr → 1fr` animates to the content's OWN height,
            so there is no magic max-height to keep in sync as children are added — and it still ends
            at `auto`, so a group never clips.
            The children stay MOUNTED (an unmounted list has no height to animate from), so
            `visibility` takes them out of the tab order while shut: a link you cannot see must not be
            focusable. It is transitioned too, so it only flips once the drawer has finished closing. */}
        <Box
          display="grid"
          gridTemplateRows={groupOpen ? "1fr" : "0fr"}
          transition="grid-template-rows 180ms ease"
        >
          <Box
            minH="0"
            overflow="hidden"
            visibility={groupOpen ? "visible" : "hidden"}
            transition="visibility 180ms"
          >
            {collapsed ? (
              // Collapsed sidebar: children are centred icons, no rail (there's no room for one).
              <Stack gap="1" pt="1">
                {group.children.map((child) => navItem(child))}
              </Stack>
            ) : (
              // Expanded: children sit a step to the right under a left rail, so the sub-menu reads as
              // a nested group rather than a flat list level with its parent (#119).
              <Stack gap="1" pt="1" ml="4" pl="2" borderLeftWidth="1px" borderColor="border">
                {group.children.map((child) => navItem(child))}
              </Stack>
            )}
          </Box>
        </Box>
      </Stack>
    );
  };

  return (
    <>
      {/* On a narrow screen the sidebar sits OVER the content; the backdrop dims the page and gives an
          outside-tap a target to close on. Only while open, only below md (#214). */}
      {open && (
        <Box
          data-testid="sidebar-backdrop"
          position="fixed"
          inset="0"
          zIndex={25}
          bg="blackAlpha.500"
          hideFrom="md"
          onClick={onClose}
        />
      )}

      {/* Brand, team switcher, nav, then the USER CARD at the foot (the mock's layout). Fixed and
          off-canvas on mobile, sticky in-flow on desktop. */}
      <Flex
        as="aside"
        direction="column"
        flexShrink={0}
        w="258px"
        bg="bg.subtle"
        borderRightWidth="1px"
        borderColor="border"
        position={{ base: "fixed", md: "sticky" }}
        top="0"
        bottom={{ base: "0", md: "auto" }}
        left="0"
        h={{ base: "100dvh", md: "100dvh" }}
        zIndex={{ base: 30, md: "auto" }}
        transform={{ base: open ? "translateX(0)" : "translateX(-100%)", md: "none" }}
        transition="transform 0.2s ease"
      >
        <Flex align="center" px="page" pt="4" pb="3" color="brand.solid">
          <Logo size={28} />
        </Flex>

        <Box px="card" pb="2">
          <TeamSwitcher collapsed={collapsed} />
        </Box>

        {/* `as="nav"` gives the links a `navigation` landmark (the <aside> alone is `complementary`),
            which the app and its e2e select the sidebar by.

            ⚠ IT MUST STAY THE FIRST NAVIGATION LANDMARK IN THE DOM. The breadcrumb in the top bar is
            a <nav> too, and the e2e reach for `getByRole("navigation").first()`. */}
        <Stack as="nav" gap="1" flex="1" overflowY="auto" px="card" py="1">
          {menu.map((entry) => (isMenuGroup(entry) ? renderGroup(entry) : navItem(entry)))}
        </Stack>

        {/* USER CARD — the identity and the account menu, at the sidebar foot. The menu opens UPWARD
            (it has nowhere below to go) and carries Theme, Language and Sign out. */}
        <Box borderTopWidth="1px" borderColor="border">
          <Menu.Root positioning={{ placement: "top-start" }}>
            <Menu.Trigger asChild>
              <Flex
                as="button"
                data-testid="user-menu"
                align="center"
                gap="2.5"
                w="full"
                px="card"
                py="2.5"
                textAlign="start"
                cursor="pointer"
                _hover={{ bg: "bg.muted" }}
              >
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

                <Icon as={ChevronsUpDown} boxSize="4" color="fg.subtle" flexShrink={0} />
              </Flex>
            </Menu.Trigger>

            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="220px">
                  {/* Theme (#214/#213) — light / dark on the color-mode tokens, the mock's placement. */}
                  <Menu.RadioItemGroup
                    value={colorMode}
                    onValueChange={(e) => setColorMode(e.value as ColorMode)}
                  >
                    <Menu.ItemGroupLabel>{t("menu.theme")}</Menu.ItemGroupLabel>
                    <Menu.RadioItem value="light" data-testid="theme-light">
                      {t("menu.themeLight")}
                      <Menu.ItemIndicator />
                    </Menu.RadioItem>
                    <Menu.RadioItem value="dark" data-testid="theme-dark">
                      {t("menu.themeDark")}
                      <Menu.ItemIndicator />
                    </Menu.RadioItem>
                  </Menu.RadioItemGroup>

                  <Menu.Separator />

                  {/* Language switcher (#93). Persists the choice and sets the page language; the
                      UI-string translation itself is the i18n effort tracked in #65. */}
                  <Menu.RadioItemGroup value={lang} onValueChange={(e) => setLang(e.value as Lang)}>
                    <Menu.ItemGroupLabel>{t("menu.language")}</Menu.ItemGroupLabel>
                    {LANGUAGES.map((l) => (
                      <Menu.RadioItem key={l.value} value={l.value} data-testid={`lang-${l.value}`}>
                        {l.label}
                        <Menu.ItemIndicator />
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioItemGroup>

                  <Menu.Separator />

                  <Menu.Item
                    value="sign-out"
                    color="fg.error"
                    data-testid="sign-out"
                    onClick={() => void logout()}
                  >
                    <Icon as={LogOut} boxSize="4" />
                    {t("menu.signOut")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Box>
      </Flex>
    </>
  );
}
