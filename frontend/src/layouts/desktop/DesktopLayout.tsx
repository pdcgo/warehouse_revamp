import { Suspense } from "react";
import { Box, Flex, Spinner } from "@chakra-ui/react";
import { Outlet, useLocation } from "react-router-dom";
import { NotMemberStrip } from "../NotMemberStrip";

import { GREY_CANVAS, usesGreyCanvas } from "../shell";
import { Sidebar } from "./Sidebar";

// THE DESKTOP SHELL: the persistent left [Sidebar] beside the routed page — and nothing above the page.
//
// NO TOP BAR (owner: *"di app shell, kita tidak perlu heading yang ada breadcrumbnya"*,
// `the-desktop-shell-has-no-top-bar`). It carried a breadcrumb — the team and the screen, both already said by the
// sidebar (the team switcher, the lit item) — and a search and a bell no service answered. With it went the
// hamburger and the off-canvas drawer it opened, which only a window narrower than this shell ever mounts at could
// have shown.
//
// WHAT IS LEFT IN HERE IS THE FRAME, and that is deliberate. Everything that decides — which menu this team gets,
// which item is lit, which group is open — is in Sidebar.
//
// ⚠ IT ONLY EVER MOUNTS ON A WIDE SCREEN ([Layout] picks by breakpoint) — a phone gets [MobileLayout] instead,
// which is a different shell rather than this one squeezed.
export function DesktopLayout() {
  const location = useLocation();

  // The page canvas is chosen by ROUTE, in [shell.ts] — both shells paint the same screens.
  const greyCanvas = usesGreyCanvas(location.pathname);

  return (
    <Flex minH="100dvh">
      <Sidebar />

      <Flex direction="column" flex="1" minW="0">
        {/* Root or the Administrator acting in a team they are not in (a-non-member-root-acts-under-a-strip). */}
        <NotMemberStrip />

        {/* The content area stays WHITE by default (so a freshly-built component isn't tinted grey);
            a page opts INTO the grey canvas by route — see `usesGreyCanvas`. */}
        <Box as="main" flex="1" overflow="auto" p="page" bg={greyCanvas ? GREY_CANVAS : undefined}>
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
