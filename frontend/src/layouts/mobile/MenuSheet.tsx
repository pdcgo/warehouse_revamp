import { useEffect, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  CloseButton,
  Drawer,
  Flex,
  Icon,
  IconButton,
  Input,
  InputGroup,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { LogOut, Menu as MenuIcon, Search, UserPen, UserRound } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../features/auth/AuthContext";
import { useTeam } from "../../features/team/TeamContext";
import { roleLabel } from "../../lib/roles";
import { LanguageSwitch, ThemeSwitch } from "../PreferenceSwitches";
import { PROFILE, activeRoute, isMenuGroup, menuFor, menuSectionsFor } from "../nav";
import type { MenuEntry, MenuItem } from "../nav";

// THE MORE SHEET — the whole menu, behind the bottom bar's last tab.
//
// It is the mobile half that THINKS (the desktop's [Sidebar] is the other one): same menu from
// nav.ts, same longest-prefix highlight — but drawn for a thumb rather than a pointer:
//
//   | desktop sidebar                       | here                                              |
//   | ------------------------------------- | ------------------------------------------------- |
//   | groups are an ACCORDION, one open     | groups are OPEN SECTIONS — the sheet scrolls       |
//   | the person and their preferences in a | their own VIEW of the sheet, a tap away            |
//   | Menu on the user card                 |                                                   |
//
// TWO VIEWS, ONE SWITCH AT THE FOOT (owner: *"tema, bahasa, dan keluar taruh di profile, jadi profile tidak masuk ke
// menu, menu ada search di bawah … di sebelah search ada pengubah tampilan"* — and *"di profile juga ada button edit
// profil, itu yang akan jadi pengganti menu profil tadi"*, `the-more-sheet-is-a-menu-and-a-profile`):
//
//   Menu                        ✕        Profil                      ✕
//   Beranda                              (A) ani
//   OPERASIONAL …                            Pemilik · Toko Melati
//   KEUANGAN …                           [✎ Edit Profil]
//   TIM …                                Tema    [☀ | ☾]
//                                        Bahasa  [ID | EN]
//                                        [⎋ Keluar]
//   [⌕ Cari menu         ] (👤)          [☰ Buka Menu         ] (👤)  ← the switch, lit
//
// The search and the switch sit at the foot, where the thumb is. Profil is no longer a menu line — Edit Profil in the
// profile view is its door. The sheet opens on the menu every time, its search empty.
export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { identity, logout } = useAuth();
  const { current } = useTeam();
  const { t } = useTranslation();
  const location = useLocation();

  const [view, setView] = useState<"menu" | "profile">("menu");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) {
      setView("menu");
      setQuery("");
    }
  }, [open]);

  const menu = menuFor(current?.teamType, current?.role);
  const activeTo = activeRoute(menu, location.pathname);
  // Profil is the profile view's Edit Profil now, not a line of the menu.
  const entries = menu.filter((entry) => isMenuGroup(entry) || entry.to !== PROFILE.to);

  // One row. EVERY link closes the sheet itself rather than leaving it to a route effect: tapping
  // the screen you are already on changes no route, and a sheet that stays open after a deliberate
  // tap reads as the tap not having registered.
  const row = (item: MenuItem, context?: string) => {
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
          <Text flex="1">{t(item.label)}</Text>
          {/* A search result says where it lives — "Laporan" alone could be three screens. */}
          {context && (
            <Text fontSize="xs" color={active ? "brand.contrast" : "fg.subtle"}>
              {context}
            </Text>
          )}
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

  // THE SEARCH — every screen of the menu with where it lives: a group's child under its group's name (its own name is
  // only "Daftar" or "Laporan"), a top-level line under its section's. A word matches either, so "penyelesaian" finds
  // the three screens of that group.
  const searchable = menuSectionsFor(current?.teamType, current?.role).flatMap((sec) =>
    sec.entries.flatMap((entry) =>
      isMenuGroup(entry)
        ? entry.children.map((item) => ({ item, context: t(entry.label) }))
        : [{ item: entry, context: sec.label ? t(sec.label) : "" }],
    ),
  );
  const term = query.trim().toLowerCase();
  const results = term
    ? searchable.filter(({ item, context }) => `${t(item.label)} ${context}`.toLowerCase().includes(term))
    : [];

  const menuView = term ? (
    <Stack gap="1" data-testid="menu-sheet-results">
      {results.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" px="3" py="2.5" data-testid="menu-sheet-no-match">
          {t("menu.noMatch")}
        </Text>
      ) : (
        results.map(({ item, context }) => row(item, context))
      )}
    </Stack>
  ) : (
    // ⚠ NOT the first `navigation` landmark on this screen — the bottom bar is, and it is earlier in the DOM. That is
    // the right order: the bar is the primary navigation and this is the overflow.
    <Stack as="nav" gap="1">
      {entries.map((entry) => section(entry))}
    </Stack>
  );

  // THE PROFILE VIEW — who is signed in and as what here, the door to their profile, their preferences and the way
  // out. Laid out flat, one tap each: a popup menu inside a sheet would be a layer on the layer that IS the dismissal.
  const profileView = (
    <Stack gap="4" py="2" data-testid="menu-sheet-profile">
      <Flex align="center" gap="3" data-testid="menu-sheet-account">
        <Avatar.Root size="md" colorPalette="brand">
          <Avatar.Fallback name={identity?.username} />
        </Avatar.Root>
        <Box flex="1" minW="0">
          <Text fontWeight="bold" truncate data-testid="current-user">
            {identity?.username}
          </Text>
          <Text fontSize="sm" color="fg.muted" truncate>
            {[roleLabel(current?.role), current?.teamName].filter(Boolean).join(" · ")}
          </Text>
        </Box>
      </Flex>

      <Button asChild variant="outline" w="full" data-testid="menu-sheet-edit-profile">
        <Link to={PROFILE.to} onClick={onClose}>
          <Icon as={UserPen} boxSize="4" />
          {t("menu.editProfile")}
        </Link>
      </Button>

      {/* TWO SWITCHES (owner: *"di tema … buat jadi switch icon matahari bulan, untuk bahasa switch ID dan EN"*,
          `the-more-sheet-switches-theme-and-language`) — the same switches the desktop's account menu draws. */}
      <Stack gap="2.5">
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
      </Stack>

      <Button variant="outline" colorPalette="error" w="full" data-testid="sign-out" onClick={() => void logout()}>
        <Icon as={LogOut} boxSize="4" />
        {t("menu.signOut")}
      </Button>
    </Stack>
  );

  const onProfile = view === "profile";

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
          <Drawer.Content roundedTop="l3" maxH="90dvh" data-testid="menu-sheet" data-view={view}>
            {/* The view's name and the way out — the person is the profile view's subject now, not the header. */}
            <Drawer.Header
              display="flex"
              alignItems="center"
              gap="2.5"
              borderBottomWidth="1px"
              borderColor="border"
              px="card"
              py="3"
            >
              <Drawer.Title flex="1" fontSize="md">
                {onProfile ? t("menu.profile") : t("shell.menu")}
              </Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Drawer.CloseTrigger>
            </Drawer.Header>

            <Drawer.Body px="card" py="2">
              {onProfile ? profileView : menuView}
            </Drawer.Body>

            {/* THE FOOT — the search (or, on the profile, the way back to the menu) and the switch beside it. */}
            <Drawer.Footer
              borderTopWidth="1px"
              borderColor="border"
              px="card"
              py="3"
              pb="calc(env(safe-area-inset-bottom) + var(--chakra-spacing-3))"
              gap="2"
            >
              {onProfile ? (
                <Button flex="1" variant="outline" data-testid="menu-sheet-open-menu" onClick={() => setView("menu")}>
                  <Icon as={MenuIcon} boxSize="4" />
                  {t("menu.openMenu")}
                </Button>
              ) : (
                <InputGroup flex="1" startElement={<Icon as={Search} boxSize="4" color="fg.subtle" />}>
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("menu.searchPlaceholder")}
                    aria-label={t("menu.searchPlaceholder")}
                    data-testid="menu-sheet-search"
                  />
                </InputGroup>
              )}
              {/* The switch stays where it is in both views — lit on the profile, so it reads as the way back too. */}
              <IconButton
                variant={onProfile ? "subtle" : "outline"}
                colorPalette={onProfile ? "brand" : "gray"}
                aria-label={t(onProfile ? "menu.showMenu" : "menu.showProfile")}
                aria-pressed={onProfile}
                data-testid="menu-sheet-switch"
                onClick={() => setView(onProfile ? "menu" : "profile")}
              >
                <Icon as={UserRound} boxSize="4" />
              </IconButton>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
