import { Suspense, useCallback, useState } from "react";
import { Box, Flex, Spinner } from "@chakra-ui/react";
import { Outlet, useLocation } from "react-router-dom";
import { NotMemberStrip } from "../NotMemberStrip";
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
//   │ [(T) Toko Melati       ⇅] │  ONE selector — the team, then the screen; a tap
//   │ [    Restock             ] │  anywhere opens the workspace drawer
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

  // The same match the tab bar and the desktop sidebar highlight with — one implementation
  // in nav.ts, because a title disagreeing with the lit tab is a bug that looks correct in each half.
  const currentLabel = activeLabel(menuFor(current?.teamType, current?.role), location.pathname);

  return (
    <Flex direction="column" h="100dvh">
      {/* TOP BAR — the team chip, then WHERE YOU ARE. No notifications (owner, `the-phone-has-no-bell`): nothing
          sends any, and a bell with a dot that never clears is a bar telling the person something false.
          The team and the screen, stacked — the two facts the desktop says with its sidebar (the
          switcher, the lit item), which a phone has no room to keep on screen. */}
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
        {/* THE WHOLE BOX IS THE SELECTOR (owner: *"pakai selector saja, semua box jadi trigger bukan hanya gambar"*,
            `the-phone-team-chip-is-the-whole-box`) — the team's avatar, its name, the screen's name and ⇅, one control.
            A tap anywhere on it opens the workspace in a drawer from the bottom
            (`the-phone-opens-its-panels-from-the-bottom`) — the ONE place a phone switches team. */}
        <TeamSwitcher panel="drawer" screen={currentLabel ? t(currentLabel) : ""} />
      </Flex>

      <NotMemberStrip />

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
