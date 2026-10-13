import { Suspense, useCallback, useState } from "react";
import { Box, Flex, Spinner } from "@chakra-ui/react";
import { Outlet, useLocation } from "react-router-dom";
import { NotMemberStrip } from "../NotMemberStrip";

import { TeamSwitcher } from "../TeamSwitcher";
import { GREY_CANVAS, usesGreyCanvas } from "../shell";
import { BottomNav } from "./BottomNav";
import { MenuSheet } from "./MenuSheet";

// THE MOBILE SHELL — the page, and a bottom tab bar. No top bar, no sidebar, no hamburger.
//
// It is a different shell rather than the desktop one squeezed, because the desktop one puts every
// navigation control in the top-left corner — the single hardest place to reach with the hand that
// is already holding the phone, while the other one holds a scanner. Here the navigation is at the
// BOTTOM, where a thumb rests: three destinations this team returns to all day ([BottomNav]), and
// everything else one tap away in [MenuSheet].
//
//   ┌──────────────────────────┐
//   │        <Outlet/>         │  the page, from the top — its own title names it; the ONLY scrolling region
//   ├──────────────────────────┤
//   │  ⌂    🛒   (TM)   📦   ☰  │  the team's destinations and More — the WORKSPACE raised in the middle,
//   │            Toko Melati    │  its team's name under it
//   └──────────────────────────┘
//
// ⚠ `h="100dvh"`, NOT `minH` — the desktop shell grows and lets the WINDOW scroll, which here would
// scroll the tab bar off the bottom of the screen. Fixing the frame and letting only <main> scroll is
// what makes the bar reachable at every scroll position, and `dvh` is what keeps it above the
// browser's own collapsing toolbar.
//
// NO TOP BAR (owner, on a phone: *"mobile tidak ada headernya"* — *"heading appshellnya"*,
// `the-phone-shell-has-no-top-bar`), as the desktop has none (`the-desktop-shell-has-no-top-bar`). It named the screen
// and only that, right above the page's own title naming it again; where you are is the lit tab and the page's title.
export function MobileLayout() {
  const location = useLocation();
  // The More sheet. Owned HERE for the same reason the desktop drawer is: the control that opens it
  // is in the tab bar, and the things that close it (a link, the backdrop, Escape) are in the sheet.
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <Flex direction="column" h="100dvh">
      <NotMemberStrip />

      {/* `p="card"` rather than the desktop's `p="page"` — a phone gutter is a gutter, not a margin;
          `page` spacing here would spend a tenth of the width on nothing.
          ⚠ THE BOTTOM IS DEEPER (owner: *"mobile app, paginasinya ketutupan"*, `the-phone-page-clears-the-bubble`): the
          workspace bubble rises 28px out of the tab bar, over the end of this scroll region — and a page's last thing
          is often centred under it (the pager). `pb="12"` (48px) is that rise plus a gap, so the end always scrolls
          clear of the bubble. */}
      <Box
        as="main"
        flex="1"
        minH="0"
        overflow="auto"
        p="card"
        pb="12"
        bg={usesGreyCanvas(location.pathname) ? GREY_CANVAS : undefined}
      >
        <Suspense fallback={<Spinner colorPalette="brand" />}>
          <Outlet />
        </Suspense>
      </Box>

      {/* The workspace bubble in the bar's centre, opening its drawer from the bottom
          (`the-phone-opens-its-panels-from-the-bottom`) — the ONE place a phone switches team. */}
      <BottomNav
        menuOpen={menuOpen}
        onMenuOpen={() => setMenuOpen(true)}
        center={<TeamSwitcher bubble panel="drawer" />}
      />
      <MenuSheet open={menuOpen} onClose={closeMenu} />
    </Flex>
  );
}
