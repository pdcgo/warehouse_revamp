import { Suspense, useCallback, useState } from "react";
import { Box, Flex, Icon, IconButton, Spinner, Text } from "@chakra-ui/react";
import { Bell } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useTeam } from "../../features/team/TeamContext";
import { TeamSwitcher } from "../TeamSwitcher";
import { activeLabel, menuFor } from "../nav";
import { GREY_CANVAS, usesGreyCanvas } from "../shell";
import { BottomNav } from "./BottomNav";
import { MenuSheet } from "./MenuSheet";

// THE MOBILE SHELL — a compact top bar, the page, and a bottom tab bar. No sidebar, no hamburger.
//
// It is a different shell rather than the desktop one squeezed, because the desktop one puts every
// navigation control in the top-left corner — the single hardest place to reach with the hand that
// is already holding the phone, while the other one holds a scanner. Here the navigation is at the
// BOTTOM, where a thumb rests: three destinations this team returns to all day ([BottomNav]), and
// everything else one tap away in [MenuSheet].
//
//   ┌──────────────────────────┐
//   │ (T)  Restock        🔔   │  the team chip, the screen, notifications
//   ├──────────────────────────┤
//   │        <Outlet/>         │  the ONLY scrolling region — the bars never leave
//   ├──────────────────────────┤
//   │  ⌂    📦    🛒    ☰      │  the team's own destinations, plus More
//   └──────────────────────────┘
//
// ⚠ `h="100dvh"`, NOT `minH` — the desktop shell grows and lets the WINDOW scroll, which here would
// scroll the tab bar off the bottom of the screen. Fixing the frame and letting only <main> scroll is
// what makes the bar reachable at every scroll position, and `dvh` is what keeps it above the
// browser's own collapsing toolbar.
export function MobileLayout() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const location = useLocation();
  // The More sheet. Owned HERE for the same reason the desktop drawer is: the control that opens it
  // is in the tab bar, and the things that close it (a link, the backdrop, Escape) are in the sheet.
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // The same match the tab bar highlights with and the desktop breadcrumb names — one implementation
  // in nav.ts, because a title disagreeing with the lit tab is a bug that looks correct in each half.
  const currentLabel = activeLabel(menuFor(current?.teamType, current?.role), location.pathname);

  return (
    <Flex direction="column" h="100dvh">
      {/* TOP BAR — the team chip, then WHERE YOU ARE, then notifications.
          It carries the same two facts as the desktop breadcrumb, in the same order (team, then
          screen) — stacked instead of separated by a chevron, because a phone has no room for a
          crumb trail and a truncated one names neither. */}
      <Flex
        as="header"
        align="center"
        gap="2.5"
        flexShrink={0}
        borderBottomWidth="1px"
        borderColor="border"
        px="card"
        py="2"
        bg="bg.subtle"
      >
        {/* Collapsed to its colour chip: the team's NAME is on the line below, and the switcher is a
            control you use once a day, not a heading. Tapping it still opens the full switcher. */}
        <TeamSwitcher collapsed />

        <Box flex="1" minW="0">
          <Text fontSize="xs" color="fg.subtle" truncate>
            {current?.teamName}
          </Text>
          <Text fontSize="sm" fontWeight="semibold" truncate data-testid="mobile-title">
            {currentLabel ? t(currentLabel) : ""}
          </Text>
        </Box>

        {/* Notifications stay; SEARCH DOES NOT. The desktop's 220px search field cannot survive at
            this width without becoming the whole bar, and it is not wired to anything yet (there is
            no search service) — a screen's own filters are where searching actually happens today. */}
        <Box position="relative" flexShrink={0}>
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

      {/* `p="card"` rather than the desktop's `p="page"` — a phone gutter is a gutter, not a margin;
          `page` spacing here would spend a tenth of the width on nothing. */}
      <Box
        as="main"
        flex="1"
        minH="0"
        overflow="auto"
        p="card"
        bg={usesGreyCanvas(location.pathname) ? GREY_CANVAS : undefined}
      >
        <Suspense fallback={<Spinner colorPalette="brand" />}>
          <Outlet />
        </Suspense>
      </Box>

      <BottomNav menuOpen={menuOpen} onMenuOpen={() => setMenuOpen(true)} />
      <MenuSheet open={menuOpen} onClose={closeMenu} />
    </Flex>
  );
}
