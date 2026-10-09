import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import {
  Avatar,
  Badge,
  Box,
  Flex,
  Icon,
  IconButton,
  Menu,
  Popover,
  Portal,
  Spacer,
  Stack,
  Text,
  Tooltip,
} from "@chakra-ui/react";
import { ChevronRight, ChevronsUpDown, CircleUser, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Logo } from "../../components/chrome/Logo";
import { useAuth } from "../../features/auth/AuthContext";
import { useLiabilityAwaiting } from "../../features/liability/queries";
import { useTeam } from "../../features/team/TeamContext";
import { LANGUAGES, useLanguage } from "../../i18n/language";
import type { Lang } from "../../i18n/language";
import { setColorMode, useColorMode } from "../../lib/colorMode";
import type { ColorMode } from "../../lib/colorMode";
import { roleLabel } from "../../lib/roles";
import { TeamSwitcher } from "../TeamSwitcher";
import { PROFILE, activeRoute, flattenMenu, isMenuGroup, menuFor, menuSectionsFor, owningGroupLabel } from "../nav";
import type { MenuGroup, MenuItem, MenuSection } from "../nav";

// THE DESKTOP SIDEBAR — brand, team switcher, navigation, and the user card at the foot.
//
// It is its own component rather than a block inside DesktopLayout because it is the half of the shell that
// THINKS: the menu it draws is computed from the current team's TYPE and the caller's ROLE, one item
// is lit by a longest-prefix match on the route, and one group at a time is open. Layout's other half
// — an <Outlet/> — has no logic in it at all, and mixing the two put ~250 lines of menu behaviour in a
// file whose job is supposed to be the page frame.
//
// THE MENU FOLLOWS THE CURRENT TEAM — its type and your role in it. Switching team switches the whole
// app's job, and what you are allowed to do in it. (Hiding a menu item is UX only; the server's
// access interceptor is what actually stops a call — never move a check into here.)
//
// IT COLLAPSES TO ITS ICONS (owner, `the-sidebar-collapses-to-its-icons`) — 258px ↔ 64px, by the « in the logo
// row or Ctrl+B, remembered in this browser, open by default and never collapsed for you:
//
//   | open                         | collapsed                                                        |
//   | ---------------------------- | ---------------------------------------------------------------- |
//   | the logo and its name        | the mark, the » under it                                         |
//   | the team switcher card       | the team's avatar — the same switcher                            |
//   | a section's heading          | a thin line                                                      |
//   | an item: icon and name       | the icon, its name in a tooltip                                  |
//   | a group: an accordion        | the icon and a dot; a CLICK opens a flyout of its children, by    |
//   |                              | name — never a hover, which a narrow corridor and a touch defeat  |
//   | Kewajiban (3)                | a small 3 on the icon's corner                                   |
//   | the user card                | the avatar — the same menu                                       |
//
// ⚠ ALWAYS IN FLOW, NEVER A DRAWER (`the-desktop-shell-has-no-top-bar`). This shell mounts only at 768px and
// wider; a handset gets [MobileLayout] — a bottom tab bar and a full-screen menu sheet — and never mounts this
// component at all, so nothing here should be tuned for touch at the expense of the pointer.
export function Sidebar() {
  const { identity, logout } = useAuth();
  const { current } = useTeam();
  const { lang, setLang } = useLanguage();
  const { t } = useTranslation();
  const colorMode = useColorMode();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, toggleCollapsed] = useCollapsed();
  // Sub-menu groups are an ACCORDION (#123): at most ONE is expanded, so opening one closes the rest
  // and the sidebar never turns into a wall of links. Null = all closed.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Collapsed, the group whose flyout is open. One at a time, and shut by any navigation.
  const [flyout, setFlyout] = useState<string | null>(null);

  // Drawn in SECTIONS (`the-sidebar-is-in-sections`); matched against the whole menu, Profile included.
  const sections = menuSectionsFor(current?.teamType, current?.role);
  const menu = menuFor(current?.teamType, current?.role);
  // Both of these are computed in nav.ts, because the phone's top bar names the screen from the SAME
  // match — see the note there.
  const activeTo = activeRoute(menu, location.pathname);
  const owningLabel = owningGroupLabel(menu, activeTo);

  // THE COUNT ON KEWAJIBAN — payments waiting for this team to confirm (`the-sidebar-is-in-sections`). Asked only
  // where the menu offers Kewajiban, and asked again on every navigation: the sidebar never remounts, and a count
  // that went stale on the first screen would say "3" all day.
  const offersLiability = flattenMenu(menu).some((item) => item.to === "/liability");
  const awaiting = useLiabilityAwaiting(current?.teamId, offersLiability);
  const { refetch: refetchAwaiting } = awaiting;
  useEffect(() => {
    if (offersLiability) {
      // Joins a fetch already in flight (the first mount's) rather than cancelling it for a second one.
      void refetchAwaiting({ cancelRefetch: false });
    }
  }, [location.pathname, offersLiability, refetchAwaiting]);
  const countOf = (item: MenuItem) => (item.to === "/liability" ? (awaiting.data ?? 0) : 0);

  // Open the group you are actually IN. With only one group allowed open (#123), landing on a
  // sub-menu route with every group shut would hide the very item that is highlighted. Keyed to the
  // route, so a group the user closes by hand stays closed until they navigate somewhere else.
  useEffect(() => {
    if (owningLabel) {
      setOpenGroup(owningLabel);
    }
  }, [owningLabel]);

  // A flyout is a way to somewhere; once you are there it is done.
  useEffect(() => {
    setFlyout(null);
  }, [location.pathname]);

  // One nav link row — shared by top-level items and group children. Active is decided by activeTo
  // (longest-prefix winner), NOT by the link's own prefix match, so siblings don't all light up.
  //
  // A GROUP'S CHILD CARRIES NO ICON (owner, provisional: *"submenu tidak perlu icon, ini keputusan sementara"*,
  // `a-submenu-item-has-no-icon`) — the icon is the front level's, the group header's and the top-level items'; under
  // the rail, and in a collapsed group's flyout, a child is its name alone.
  const navItem = (item: MenuItem, child = false) => {
    const active = item.to === activeTo;
    const count = countOf(item);
    // Collapsed, a top-level item is its icon; a child only ever shows in a flyout, where it has room for its name.
    const iconOnly = collapsed && !child;

    const row = (
      <Link
        key={item.to}
        to={item.to}
        aria-current={active ? "page" : undefined}
        // Collapsed, the name is in a tooltip — the link still has to be called something.
        aria-label={iconOnly ? t(item.label) : undefined}
      >
        <Flex
          align="center"
          gap="2.5"
          rounded="md"
          px="3"
          py="2"
          fontSize="sm"
          fontWeight="medium"
          justify={iconOnly ? "center" : "flex-start"}
          bg={active ? "brand.solid" : "transparent"}
          color={active ? "brand.contrast" : "fg.muted"}
          _hover={active ? undefined : { bg: "brand.subtle", color: "brand.fg" }}
        >
          {!child && (
            <Box position="relative" lineHeight="0" flexShrink={0}>
              <Icon as={item.icon} boxSize="4" />
              {/* Collapsed, the count rides the icon's corner. */}
              {iconOnly && count > 0 && <CornerCount count={count} active={active} testId={`nav-count-${item.to}`} />}
            </Box>
          )}
          {!iconOnly && <Text flex="1">{t(item.label)}</Text>}
          {/* Something to act on — never a 0 (`the-sidebar-is-in-sections`). Rose on the page, white on the lit row. */}
          {!iconOnly && count > 0 && (
            <Badge
              size="sm"
              variant="solid"
              rounded="full"
              bg={active ? "brand.contrast" : "brand.solid"}
              color={active ? "brand.solid" : "brand.contrast"}
              data-testid={`nav-count-${item.to}`}
            >
              {count}
            </Badge>
          )}
        </Flex>
      </Link>
    );

    if (!iconOnly) {
      return row;
    }

    // The name, and what the count counts, beside the icon.
    const tip = count > 0 ? `${t(item.label)} · ${t("liability.awaitingNav", { count })}` : t(item.label);

    return (
      <Tip key={item.to} label={tip}>
        {row}
      </Tip>
    );
  };

  // A section: its small heading, then its entries. The lead section — Home — has no heading; collapsed, a heading
  // is a thin line, which still says where one section ends and the next begins.
  const renderSection = (section: MenuSection) => (
    <Stack key={section.label ?? "lead"} gap="1" data-testid={`nav-section-${section.label ?? "lead"}`}>
      {section.label &&
        (collapsed ? (
          <Box h="1px" bg="border" mx="2" my="2" aria-hidden />
        ) : (
          <Text
            px="3"
            pt="3"
            pb="0.5"
            fontSize="xs"
            fontWeight="bold"
            color="fg.subtle"
            textTransform="uppercase"
            letterSpacing="wider"
          >
            {t(section.label)}
          </Text>
        ))}
      {section.entries.map((entry) => (isMenuGroup(entry) ? renderGroup(entry) : navItem(entry)))}
    </Stack>
  );

  // Collapsed, a group is its icon and a dot — a CLICK opens its children beside it, by name. Its icon is tinted
  // while you are inside it, as the open sidebar tints its header.
  const renderFlyoutGroup = (group: MenuGroup) => {
    const groupActive = group.children.some((child) => child.to === activeTo);

    return (
      <Popover.Root
        key={group.label}
        // Mounted only while open — a shut flyout must not leave a second copy of its links in the page.
        lazyMount
        unmountOnExit
        open={flyout === group.label}
        onOpenChange={(e) => setFlyout(e.open ? group.label : null)}
        positioning={{ placement: "right-start", gutter: 10 }}
      >
        <Popover.Trigger asChild>
          <Flex
            as="button"
            align="center"
            justify="center"
            rounded="md"
            px="3"
            py="2"
            cursor="pointer"
            bg={groupActive ? "brand.subtle" : "transparent"}
            color={groupActive ? "brand.fg" : "fg.muted"}
            _hover={{ bg: "brand.subtle", color: "brand.fg" }}
            aria-label={t(group.label)}
            data-testid={`nav-group-toggle-${group.label}`}
          >
            <Box position="relative" lineHeight="0">
              <Icon as={group.icon} boxSize="4" />
              {/* The dot says "there is more behind this" — a group, not a page. */}
              <Box position="absolute" bottom="-1" right="-1.5" boxSize="1.5" rounded="full" bg="currentColor" />
            </Box>
          </Flex>
        </Popover.Trigger>
        <Portal>
          <Popover.Positioner>
            <Popover.Content w="auto" minW="48" p="1.5" data-testid={`nav-flyout-${group.label}`}>
              <Text
                px="3"
                pt="1"
                pb="1.5"
                fontSize="xs"
                fontWeight="bold"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="wider"
              >
                {t(group.label)}
              </Text>
              <Stack gap="1">{group.children.map((child) => navItem(child, true))}</Stack>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
    );
  };

  // A collapsible sub-menu group (#104): a clickable header (Capitalized, not uppercase) toggles its
  // children.
  const renderGroup = (group: MenuGroup) => {
    if (collapsed) {
      return renderFlyoutGroup(group);
    }

    const groupOpen = openGroup === group.label;
    // Tint the header when the active route lives inside this group, so you can still tell which
    // group you're in when it's shut and its children are hidden.
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
          _hover={{ bg: "brand.subtle", color: "brand.fg" }}
          data-testid={`nav-group-toggle-${group.label}`}
          // Opening a group closes whichever one was open; clicking the open one shuts it.
          onClick={() => setOpenGroup((prev) => (prev === group.label ? null : group.label))}
        >
          <Icon as={group.icon} boxSize="4" flexShrink={0} />
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
            {/* Children sit a step to the right under a left rail, so the sub-menu reads as a nested group
                rather than a flat list level with its parent (#119). */}
            <Stack gap="1" pt="1" ml="4" pl="2" borderLeftWidth="1px" borderColor="border">
              {group.children.map((child) => navItem(child, true))}
            </Stack>
          </Box>
        </Box>
      </Stack>
    );
  };

  // « open, » collapsed — the same button, its name and the shortcut in its tooltip.
  const toggleLabel = collapsed ? t("shell.expandMenu") : t("shell.collapseMenu");
  const toggle = (
    <Tip label={`${toggleLabel} · Ctrl+B`}>
      <IconButton
        size="xs"
        variant="ghost"
        color="fg.muted"
        aria-label={toggleLabel}
        aria-expanded={!collapsed}
        // A ghost button shades itself while `aria-expanded` — here that is the resting state, not a press.
        _expanded={{ bg: "transparent" }}
        _hover={{ bg: "bg.muted" }}
        data-testid="sidebar-toggle"
        onClick={toggleCollapsed}
      >
        <Icon as={collapsed ? PanelLeftOpen : PanelLeftClose} boxSize="4" />
      </IconButton>
    </Tip>
  );

  return (
    <>
      {/* Brand, team switcher, nav, then the USER CARD at the foot (the mock's layout). Sticky, in flow. */}
      <Flex
        as="aside"
        direction="column"
        flexShrink={0}
        w={collapsed ? "16" : "258px"}
        transition="width 180ms ease"
        overflowX="hidden"
        whiteSpace="nowrap"
        bg="bg.subtle"
        borderRightWidth="1px"
        borderColor="border"
        position="sticky"
        top="0"
        h="100dvh"
        data-collapsed={collapsed ? "" : undefined}
        data-testid="sidebar"
      >
        {collapsed ? (
          <Stack align="center" gap="2" pt="4" pb="2">
            <Logo size={28} showWordmark={false} />
            {toggle}
          </Stack>
        ) : (
          <Flex align="center" ps="page" pe="card" pt="4" pb="3">
            <Logo size={28} />
            <Spacer />
            {toggle}
          </Flex>
        )}

        <Flex justify="center" px={collapsed ? "0" : "card"} pb="2">
          {/* The workspace opens UNDER its card — beside the avatar when collapsed (`the-workspace-opens-under-its-card`). */}
          <TeamSwitcher collapsed={collapsed} panel={collapsed ? "right" : "below"} />
        </Flex>

        {/* `as="nav"` gives the links a `navigation` landmark (the <aside> alone is `complementary`),
            which the app and its e2e select the sidebar by — `getByRole("navigation").first()`. A page
            with a breadcrumb of its own adds a second <nav> after it. */}
        <Stack as="nav" gap="1" flex="1" overflowY="auto" overflowX="hidden" px={collapsed ? "2" : "card"} py="1">
          {sections.map(renderSection)}
        </Stack>

        {/* USER CARD — the identity and the account menu, at the sidebar foot. The menu opens UPWARD
            (it has nowhere below to go) and carries Profile, Theme, Language and Sign out — Profile is the
            person's, not the team's, so it left the menu for here (`the-sidebar-is-in-sections`). Collapsed,
            the card is its avatar and the menu is the same. */}
        <Box borderTopWidth="1px" borderColor="border">
          <Menu.Root positioning={{ placement: collapsed ? "right-end" : "top-start" }}>
            <Menu.Trigger asChild>
              <Flex
                as="button"
                data-testid="user-menu"
                align="center"
                justify={collapsed ? "center" : "flex-start"}
                gap="2.5"
                w="full"
                px={collapsed ? "0" : "card"}
                py="2.5"
                textAlign="start"
                cursor="pointer"
                _hover={{ bg: "bg.muted" }}
                aria-label={collapsed ? identity?.username : undefined}
              >
                <Avatar.Root size="sm" colorPalette="brand">
                  <Avatar.Fallback name={identity?.username} />
                </Avatar.Root>

                {/* Collapsed, the name stays for a screen reader (and for the e2e that reads who is signed in). */}
                <Box flex="1" minW="0" srOnly={collapsed}>
                  <Text fontSize="sm" fontWeight="semibold" truncate data-testid="current-user">
                    {identity?.username}
                  </Text>
                  <Text fontSize="xs" color="fg.subtle" truncate>
                    {roleLabel(current?.role)}
                  </Text>
                </Box>

                {!collapsed && <Icon as={ChevronsUpDown} boxSize="4" color="fg.subtle" flexShrink={0} />}
              </Flex>
            </Menu.Trigger>

            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="220px">
                  <Menu.Item value="profile" data-testid="user-menu-profile" onClick={() => navigate(PROFILE.to)}>
                    <Icon as={CircleUser} boxSize="4" />
                    {t(PROFILE.label)}
                  </Menu.Item>

                  <Menu.Separator />

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

// ── Collapsing ──────────────────────────────────────────────────────────────────────────────────

// The choice is this browser's — a per-viewer convenience, open until somebody collapses it.
const COLLAPSED_KEY = "wh-sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** The sidebar's collapsed state: remembered, and toggled by the button or Ctrl+B (⌘B on a Mac). */
function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Storage refused (a private window) — the choice lasts until the page is closed.
    }
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "b" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) {
        return;
      }
      // Not while typing — the shortcut belongs to the app, not to the field a person is writing in.
      if (isTyping(e.target)) {
        return;
      }
      e.preventDefault();
      toggle();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return [collapsed, toggle];
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** A tooltip to the right — what a collapsed sidebar says instead of its labels. */
function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip.Root openDelay={150} closeDelay={50} positioning={{ placement: "right" }}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content>{label}</Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}

/** A collapsed item's count, on its icon's corner — white-on-rose, or rose-on-white on the lit row. */
function CornerCount({ count, active, testId }: { count: number; active: boolean; testId: string }) {
  return (
    <Box
      position="absolute"
      top="-1.5"
      right="-2"
      minW="3.5"
      h="3.5"
      px="0.5"
      rounded="full"
      display="flex"
      alignItems="center"
      justifyContent="center"
      fontSize="2xs"
      fontWeight="bold"
      // ⚠ A unitless 3.5 here was 3.5 × the font size — a 35px line in a 14px dot, the figure pushed out of it.
      lineHeight="1"
      bg={active ? "brand.contrast" : "brand.solid"}
      color={active ? "brand.solid" : "brand.contrast"}
      data-testid={testId}
    >
      {count}
    </Box>
  );
}
