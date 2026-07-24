import { Suspense, useEffect, useState } from "react";
import {
  Bell,
  ChevronRight,
  ChevronsUpDown,
  Globe,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../features/auth/AuthContext";
import { useTeam } from "../features/team/TeamContext";
import { LANGUAGES, useLanguage } from "../i18n/language";
import type { Lang } from "../i18n/language";
import { TeamSwitcher } from "./TeamSwitcher";
import { Logo } from "../components/Logo";
import { IconButton } from "../components/ui/Button";
import { Menu, Portal } from "../components/ui/Menu";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../components/ui/cn";
import { useColorMode, setColorMode } from "../lib/colorMode";
import type { ColorMode } from "../lib/colorMode";
import { roleLabel } from "../lib/roles";
import { isMenuGroup, menuFor } from "./nav";
import type { MenuGroup, MenuItem } from "./nav";

// The first letter of the first and last word of a name, upper-cased — the avatar fallback when there
// is no picture. Mirrors what Chakra's Avatar derived for the user card.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

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
    const ItemIcon = item.icon;

    return (
      <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined}>
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm",
            collapsed ? "justify-center" : "justify-start",
            active
              ? "bg-accent font-semibold text-white"
              : "font-medium text-fg-muted hover:bg-accent-soft hover:text-accent-fg",
          )}
        >
          <ItemIcon className="size-4 shrink-0" />
          {!collapsed && <span>{t(item.label)}</span>}
        </div>
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
    const GroupIcon = group.icon;

    return (
      <div key={group.label} className="flex flex-col gap-1" data-testid={`nav-group-${group.label}`}>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium hover:bg-accent-soft hover:text-accent-fg",
            collapsed ? "justify-center" : "justify-start",
            groupActive ? "text-accent-fg" : "text-fg-muted",
          )}
          data-testid={`nav-group-toggle-${group.label}`}
          // Opening a group closes whichever one was open; clicking the open one shuts it.
          onClick={() => setOpenGroup((prev) => (prev === group.label ? null : group.label))}
        >
          <GroupIcon className="size-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-start">{t(group.label)}</span>
              {/* One chevron that TURNS, rather than two that swap — swapping is a jump cut, and the
                  rotation is the same motion the drawer below is making (#123). */}
              <ChevronRight
                className="size-4 shrink-0"
                style={{
                  transform: open ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 180ms ease",
                }}
              />
            </>
          )}
        </button>

        {/* The drawer (#123). `grid-template-rows: 0fr → 1fr` animates to the content's OWN height,
            so there is no magic max-height to keep in sync as children are added — and it still ends
            at `auto`, so a group never clips.
            The children stay MOUNTED (an unmounted list has no height to animate from), so
            `visibility` takes them out of the tab order while shut: a link you cannot see must not be
            focusable. It is transitioned too, so it only flips once the drawer has finished closing. */}
        <div
          className="grid"
          style={{
            gridTemplateRows: open ? "1fr" : "0fr",
            transition: "grid-template-rows 180ms ease",
          }}
        >
          <div
            className="min-h-0 overflow-hidden"
            style={{ visibility: open ? "visible" : "hidden", transition: "visibility 180ms" }}
          >
            {collapsed ? (
              // Collapsed sidebar: children are centred icons, no rail (there's no room for one).
              <div className="flex flex-col gap-1 pt-1">
                {group.children.map((child) => navItem(child))}
              </div>
            ) : (
              // Expanded: children sit a step to the right under a left rail, so the sub-menu reads as
              // a nested group rather than a flat list level with its parent (#119).
              <div className="ml-4 flex flex-col gap-1 border-l border-line pl-2 pt-1">
                {group.children.map((child) => navItem(child))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-dvh">
      {/* On a narrow screen the sidebar sits OVER the content; the backdrop dims the page and gives an
          outside-tap a target to close on. Only while open, only below md (#214). */}
      {drawerOpen && (
        <div
          data-testid="sidebar-backdrop"
          className="fixed inset-0 z-[25] bg-black/45 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* SIDEBAR — brand, team switcher, nav, then the USER CARD at the foot (the mock's layout). Fixed
          and off-canvas on mobile, sticky in-flow on desktop. */}
      <aside
        className={cn(
          "flex w-[258px] shrink-0 flex-col border-r border-line bg-sidebar",
          "fixed inset-y-0 left-0 z-30 h-dvh transition-transform duration-200 ease-out",
          "md:sticky md:top-0 md:z-auto md:translate-x-0",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center px-page pt-4 pb-3 text-accent">
          <Logo size={28} />
        </div>

        <div className="px-card pb-2">
          <TeamSwitcher collapsed={collapsed} />
        </div>

        {/* `<nav>` gives the links a `navigation` landmark (the <aside> alone is `complementary`),
            which the app and its e2e select the sidebar by. */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-card py-1">
          {menu.map((entry) => (isMenuGroup(entry) ? renderGroup(entry) : navItem(entry)))}
        </nav>

        {/* USER CARD — the identity and the account menu, at the sidebar foot. The menu opens UPWARD
            (it has nowhere below to go) and carries Theme, Language and Sign out. */}
        <div className="border-t border-line">
          <Menu.Root positioning={{ placement: "top-start" }}>
            <Menu.Trigger asChild>
              <button
                type="button"
                data-testid="user-menu"
                className="flex w-full items-center gap-2.5 px-card py-2.5 text-start hover:bg-surface-2"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-fg">
                  {initials(identity?.username ?? "")}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" data-testid="current-user">
                    {identity?.username}
                  </p>
                  <p className="truncate text-xs text-fg-subtle">{roleLabel(current?.role)}</p>
                </div>

                <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" />
              </button>
            </Menu.Trigger>

            <Portal>
              <Menu.Positioner>
                <Menu.Content>
                  {/* Theme (#214/#213) — light / dark on the color-mode tokens, the mock's placement. */}
                  <Menu.RadioItemGroup
                    value={colorMode}
                    onValueChange={(e) => setColorMode(e.value as ColorMode)}
                  >
                    <Menu.ItemGroupLabel>{t("menu.theme")}</Menu.ItemGroupLabel>
                    <Menu.RadioItem value="light" data-testid="theme-light">
                      <Sun className="size-4" />
                      {t("menu.themeLight")}
                      <Menu.ItemIndicator />
                    </Menu.RadioItem>
                    <Menu.RadioItem value="dark" data-testid="theme-dark">
                      <Moon className="size-4" />
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
                        <Globe className="size-4" />
                        {l.label}
                        <Menu.ItemIndicator />
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioItemGroup>

                  <Menu.Separator />

                  <Menu.Item
                    value="sign-out"
                    className="text-neg [&_svg]:text-neg!"
                    data-testid="sign-out"
                    onSelect={() => void logout()}
                  >
                    <LogOut className="size-4" />
                    {t("menu.signOut")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* TOPBAR — hamburger (mobile), the breadcrumb, then search and notifications on the right
            (the mock's header; the user menu lives in the sidebar, not here). Sticky. */}
        <header className="sticky top-0 z-20 flex items-center gap-card border-b border-line bg-bg/80 px-page py-card backdrop-blur-md">
          <IconButton
            size="xs"
            variant="outline"
            aria-label={t("shell.openMenu")}
            data-testid="sidebar-hamburger"
            className="md:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon className="size-4" />
          </IconButton>

          {/* Breadcrumb — kept a plain span (not a <nav>) so the sidebar stays the shell's single
              `navigation` landmark the e2e selects by. */}
          <span className="text-sm text-fg-subtle">
            {current?.teamName && (
              <>
                {current.teamName}
                <span className="px-1">/</span>
              </>
            )}
            <span className="font-semibold text-fg">{currentLabel ? t(currentLabel) : ""}</span>
          </span>

          <div className="flex-1" />

          {/* Search and notifications are the mock's top-bar chrome. Neither is wired to a backend yet
              (there is no search or notifications service) — they are the frame those land in. */}
          <span className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              placeholder={t("shell.search")}
              data-testid="global-search"
              className="h-8 w-[220px] rounded-full border border-line-strong bg-surface pl-8 pr-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent"
            />
          </span>

          <div className="relative">
            <IconButton
              size="sm"
              variant="outline"
              aria-label={t("shell.notifications")}
              data-testid="notifications"
            >
              <Bell className="size-4" />
            </IconButton>
            <span className="pointer-events-none absolute right-1 top-1 size-2 rounded-full border-[1.5px] border-bg bg-warn" />
          </div>
        </header>

        <main className="flex-1 overflow-auto p-page">
          {/* Each route's page is code-split (React.lazy in router.tsx); this boundary shows a
              spinner for the brief moment its chunk is fetched. */}
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
