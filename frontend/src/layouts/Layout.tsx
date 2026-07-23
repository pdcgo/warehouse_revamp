import { Suspense, useEffect, useState } from "react";
import {
  Avatar,
  Box,
  Breadcrumb,
  Flex,
  Icon,
  IconButton,
  Menu,
  Portal,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../features/auth/AuthContext";
import { useTeam } from "../features/team/TeamContext";
import { LANGUAGES, useLanguage } from "../i18n/language";
import type { Lang } from "../i18n/language";
import { TeamSwitcher } from "./TeamSwitcher";
import { Logo, WarehouseMark } from "../components/Logo";
import { useColorMode, setColorMode } from "../lib/colorMode";
import type { ColorMode } from "../lib/colorMode";
import { isMenuGroup, menuFor } from "./nav";
import type { MenuGroup, MenuItem } from "./nav";

// The app shell: a persistent left sidebar (brand, team switcher, navigation) beside a content
// column with a slim top bar (identity + sign out).
//
// THE MENU FOLLOWS THE CURRENT TEAM — its type and your role in it. Switching team switches the
// whole app's job, and what you are allowed to do in it. (Hiding a menu item is UX only; the
// server's access interceptor is what actually stops a call — never move a check into here.)
export function Layout() {
  const { identity, logout } = useAuth();
  const { current } = useTeam();
  const { lang, setLang } = useLanguage();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  // On a NARROW screen the sidebar is off-canvas behind a hamburger (#214); this is its open state.
  // It has no effect on desktop, where the sidebar is always in the flow.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const colorMode = useColorMode();
  // Sub-menu groups are an ACCORDION (#123): at most ONE is expanded, so opening one closes the rest
  // and the sidebar never turns into a wall of links. Null = all closed.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const location = useLocation();

  const menu = menuFor(current?.teamType, current?.role);

  // Flatten groups to their child links so both the active state and the breadcrumb can match a
  // sub-menu route.
  const flatItems: MenuItem[] = menu.flatMap((entry) => (isMenuGroup(entry) ? entry.children : [entry]));

  // matchesPath is a true path-segment prefix test: "/products" matches "/products" and
  // "/products/123" but NOT "/products-x" (a bare startsWith would). "/" only matches itself.
  const matchesPath = (to: string) =>
    to === "/"
      ? location.pathname === "/"
      : location.pathname === to || location.pathname.startsWith(`${to}/`);

  // The active route is the item whose `to` is the LONGEST matching prefix — so on /products/discover
  // only "Discover Product" lights up, not "My Product" too, while a detail route like /products/123
  // still lights up its parent "My Product" (#119). One winner, never a whole sub-menu at once.
  const activeTo = flatItems
    .filter((item) => matchesPath(item.to))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;

  // The current page's label, derived from the active route — drives the top-bar breadcrumb/title.
  const currentLabel = flatItems.find((item) => item.to === activeTo)?.label ?? "";

  // Open the group you are actually IN. With only one group allowed open (#123), landing on a
  // sub-menu route with every group shut would hide the very item that is highlighted. Keyed to the
  // route, so a group the user closes by hand stays closed until they navigate somewhere else.
  const owningGroup = menu.find(
    (entry) => isMenuGroup(entry) && entry.children.some((child) => child.to === activeTo),
  );
  const owningLabel = owningGroup && isMenuGroup(owningGroup) ? owningGroup.label : undefined;

  useEffect(() => {
    if (owningLabel) {
      setOpenGroup(owningLabel);
    }
  }, [owningLabel]);

  // Navigating closes the mobile drawer (#214): a link tap should reveal the page, not leave the
  // sidebar covering it. No-op on desktop, where the drawer is never open.
  useEffect(() => {
    setDrawerOpen(false);
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
    const open = collapsed || openGroup === group.label;
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
                transform={open ? "rotate(90deg)" : "rotate(0deg)"}
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
          gridTemplateRows={open ? "1fr" : "0fr"}
          transition="grid-template-rows 180ms ease"
        >
          <Box
            minH="0"
            overflow="hidden"
            visibility={open ? "visible" : "hidden"}
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
    <Flex minH="100dvh">
      {/* On a narrow screen the sidebar sits OVER the content, so the backdrop both dims the page and
          gives an outside-tap a target to close on. It exists only while the drawer is open, and only
          below the md breakpoint (#214). */}
      {drawerOpen && (
        <Box
          data-testid="sidebar-backdrop"
          position="fixed"
          inset="0"
          zIndex={25}
          bg="blackAlpha.500"
          hideFrom="md"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <Flex
        as="nav"
        direction="column"
        gap="section"
        flexShrink={0}
        // Off-canvas on mobile (fixed + slide), in-flow on desktop. The collapse rail is a DESKTOP
        // affordance only — on mobile the drawer is always the full width when open.
        position={{ base: "fixed", md: "static" }}
        top="0"
        bottom="0"
        left="0"
        zIndex={{ base: 30, md: "auto" }}
        h={{ base: "100dvh", md: "auto" }}
        bg="bg.subtle"
        transform={{
          base: drawerOpen ? "translateX(0)" : "translateX(-100%)",
          md: "none",
        }}
        transition="transform 0.2s ease, width 0.15s ease"
        w={{ base: "260px", md: collapsed ? "64px" : "240px" }}
        borderRightWidth="1px"
        borderColor="border"
        p="card"
      >
        <Box px="2" py="1" overflow="hidden" color="brand.solid">
          {collapsed ? <WarehouseMark size={26} /> : <Logo size={28} />}
        </Box>

        <TeamSwitcher collapsed={collapsed} />

        <Stack gap="1" flex="1">
          {menu.map((entry) =>
            isMenuGroup(entry) ? renderGroup(entry) : navItem(entry),
          )}
        </Stack>

        {/* Collapse-to-rail is a DESKTOP affordance; on mobile the sidebar is a full-width drawer, so
            the toggle is hidden below md (#214). */}
        <Flex justify={collapsed ? "center" : "flex-end"} hideBelow="md">
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((v) => !v)}
          >
            <Icon as={collapsed ? PanelLeftOpen : PanelLeftClose} boxSize="4" />
          </IconButton>
        </Flex>
      </Flex>

      <Flex direction="column" flex="1" minW="0">
        <Flex
          as="header"
          align="center"
          gap="section"
          borderBottomWidth="1px"
          borderColor="border"
          px="page"
          py="card"
        >
          {/* The hamburger reveals the off-canvas sidebar on mobile only (#214). */}
          <IconButton
            size="xs"
            variant="outline"
            aria-label="Open menu"
            data-testid="sidebar-hamburger"
            hideFrom="md"
            onClick={() => setDrawerOpen(true)}
          >
            <Icon as={MenuIcon} boxSize="4" />
          </IconButton>

          <Breadcrumb.Root size="lg">
            <Breadcrumb.List>
              <Breadcrumb.Item>
                <Breadcrumb.CurrentLink fontWeight="semibold" color="fg">
                  {currentLabel ? t(currentLabel) : ""}
                </Breadcrumb.CurrentLink>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb.Root>

          <Spacer />

          <Menu.Root positioning={{ placement: "bottom-end" }}>
            <Menu.Trigger asChild>
              <Flex
                as="button"
                data-testid="user-menu"
                align="center"
                gap="2"
                rounded="md"
                px="2"
                py="1"
                cursor="pointer"
                _hover={{ bg: "bg.muted" }}
              >
                <Avatar.Root size="xs" colorPalette="brand">
                  <Avatar.Fallback name={identity?.username} />
                </Avatar.Root>

                <Text fontSize="sm" color="fg.muted" data-testid="current-user">
                  {identity?.username}
                </Text>

                <Icon as={ChevronDown} boxSize="4" color="fg.muted" flexShrink={0} />
              </Flex>
            </Menu.Trigger>

            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="200px">
                  {/* Theme (#214) — light / dark, on the color-mode tokens from #213. The mock puts
                      this control in the user menu; setColorMode flips the `.dark` class and remembers
                      the choice. */}
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
        </Flex>

        <Box as="main" flex="1" overflow="auto" p="page">
          {/* Each route's page is code-split (React.lazy in router.tsx); this boundary shows a
              spinner for the brief moment its chunk is fetched. */}
          <Suspense fallback={<Spinner colorPalette="brand" />}>
            <Outlet />
          </Suspense>
        </Box>
      </Flex>
    </Flex>
  );
}
