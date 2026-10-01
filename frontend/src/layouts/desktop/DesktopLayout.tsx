import { Suspense, useCallback, useState } from "react";
import {
  Box,
  Breadcrumb,
  Flex,
  Icon,
  IconButton,
  Input,
  InputGroup,
  Spacer,
  Spinner,
} from "@chakra-ui/react";
import { Bell, Menu as MenuIcon, Search } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useTeam } from "../../features/team/TeamContext";
import { activeLabel, menuFor } from "../nav";
import { GREY_CANVAS, usesGreyCanvas } from "../shell";
import { Sidebar } from "./Sidebar";

// THE DESKTOP SHELL: the persistent left [Sidebar] beside a content column with a slim top bar
// (breadcrumb, search, notifications) and the routed page under it.
//
// WHAT IS LEFT IN HERE IS THE FRAME, and that is deliberate. Everything that decides — which menu
// this team gets, which item is lit, which group is open — moved into Sidebar; this file arranges
// three boxes and owns exactly one piece of state, the drawer, because the control that OPENS it
// (the hamburger) is in the top bar while everything that CLOSES it belongs to the sidebar.
//
// ⚠ IT ONLY EVER MOUNTS ON A WIDE SCREEN ([Layout] picks by breakpoint), so its narrow-screen
// behaviour is now only about a WINDOW being dragged small on a desktop — a phone gets
// [MobileLayout] instead, which is a different shell rather than this one squeezed. The off-canvas
// drawer stays for exactly that in-between case.
export function DesktopLayout() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const location = useLocation();
  // On a narrow screen the sidebar is off-canvas behind a hamburger (#214); this is its open state.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // STABLE, on purpose — the sidebar closes the drawer from an effect keyed on the route, and a new
  // function every render would re-run it every render (see the note in Sidebar).
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // The breadcrumb names the current screen, and it reads the SAME match the sidebar lights an item
  // with — one implementation in nav.ts, because a breadcrumb disagreeing with the highlight is a
  // bug that looks correct in both halves separately.
  const currentLabel = activeLabel(menuFor(current?.teamType, current?.role), location.pathname);

  // The page canvas is chosen by ROUTE, in [shell.ts] — both shells paint the same screens.
  const greyCanvas = usesGreyCanvas(location.pathname);

  return (
    <Flex minH="100dvh">
      <Sidebar open={drawerOpen} onClose={closeDrawer} />

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
