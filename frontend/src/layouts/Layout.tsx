import { Suspense, useEffect, useState } from "react";
import {
  Avatar,
  Box,
  Breadcrumb,
  Flex,
  Icon,
  IconButton,
  Input,
  InputGroup,
  Menu,
  Portal,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  Bell,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  Menu as MenuIcon,
  Search,
} from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../features/auth/AuthContext";
import { useTeam } from "../features/team/TeamContext";
import { LANGUAGES, useLanguage } from "../i18n/language";
import type { Lang } from "../i18n/language";
import { TeamSwitcher } from "./TeamSwitcher";
import { Logo } from "../components/Logo";
import { useColorMode, setColorMode } from "../lib/colorMode";
import type { ColorMode } from "../lib/colorMode";
import { roleLabel } from "../lib/roles";
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
  // On a narrow screen the sidebar is off-canvas behind a hamburger (#214); this is its open state.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const colorMode = useColorMode();
  // The nav renders at full width — the collapse-to-rail affordance the mock does not have was
  // dropped. Kept as a const so the shared navItem / TeamSwitcher signatures stay put.
  const collapsed = false;
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
      {/* On a narrow screen the sidebar sits OVER the content; the backdrop dims the page and gives an
          outside-tap a target to close on. Only while open, only below md (#214). */}
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

      {/* SIDEBAR — brand, team switcher, nav, then the USER CARD at the foot (the mock's layout). Fixed
          and off-canvas on mobile, sticky in-flow on desktop. */}
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
        transform={{ base: drawerOpen ? "translateX(0)" : "translateX(-100%)", md: "none" }}
        transition="transform 0.2s ease"
      >
        <Flex align="center" px="page" pt="4" pb="3" color="brand.solid">
          <Logo size={28} />
        </Flex>

        <Box px="card" pb="2">
          <TeamSwitcher collapsed={collapsed} />
        </Box>

        {/* `as="nav"` gives the links a `navigation` landmark (the <aside> alone is `complementary`),
            which the app and its e2e select the sidebar by. */}
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

      <Flex direction="column" flex="1" minW="0">
        {/* TOPBAR — hamburger (mobile), the breadcrumb, then search and notifications on the right
            (the mock's header; the user menu lives in the sidebar, not here). Sticky. */}
        <Flex
          as="header"
          align="center"
          gap="card"
          borderBottomWidth="1px"
          borderColor="border"
          px="page"
          py="card"
          position="sticky"
          top="0"
          zIndex={20}
          bg="bg.subtle"
        >
          <IconButton
            size="xs"
            variant="outline"
            aria-label={t("shell.openMenu")}
            data-testid="sidebar-hamburger"
            hideFrom="md"
            onClick={() => setDrawerOpen(true)}
          >
            <Icon as={MenuIcon} boxSize="4" />
          </IconButton>

          <Breadcrumb.Root size="lg">
            <Breadcrumb.List>
              {current?.teamName && (
                <>
                  <Breadcrumb.Item>
                    <Breadcrumb.Link color="fg.subtle">{current.teamName}</Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                </>
              )}
              <Breadcrumb.Item>
                <Breadcrumb.CurrentLink fontWeight="semibold" color="fg">
                  {currentLabel ? t(currentLabel) : ""}
                </Breadcrumb.CurrentLink>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb.Root>

          <Spacer />

          {/* Search and notifications are the mock's top-bar chrome. Neither is wired to a backend yet
              (there is no search or notifications service) — they are the frame those land in. */}
          <InputGroup
            startElement={<Icon as={Search} boxSize="4" color="fg.subtle" />}
            maxW="220px"
            hideBelow="sm"
          >
            <Input placeholder={t("shell.search")} rounded="full" size="sm" data-testid="global-search" />
          </InputGroup>

          <Box position="relative">
            <IconButton
              size="sm"
              variant="outline"
              aria-label={t("shell.notifications")}
              data-testid="notifications"
            >
              <Icon as={Bell} boxSize="4" />
            </IconButton>
            <Box
              position="absolute"
              top="1"
              right="1"
              boxSize="2"
              bg="orange.solid"
              rounded="full"
              borderWidth="1.5px"
              borderColor="bg.subtle"
              pointerEvents="none"
            />
          </Box>
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
