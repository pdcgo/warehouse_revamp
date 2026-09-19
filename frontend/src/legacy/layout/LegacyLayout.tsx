import { useEffect, useRef, type ReactNode } from "react";
import { Box, Flex } from "@chakra-ui/react";
import { useLocation } from "react-router-dom";
import { CheckCredential } from "./CheckCredential";
import { MobileTopbar } from "./MobileTopbar";
import { ScrollTop } from "./ScrollTop";
import { Sidebar, type SidebarSection } from "./Sidebar";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import type { Role } from "../../gen/warehouse/role_base/v1/role_pb";

// ⚠ THIS IS A SECOND SHELL, AND IT IS NOT THE APP'S SHELL.
//
// The live app uses TWO shells picked by a JS breakpoint — `src/layouts/` mounts either
// `DesktopLayout` or `MobileLayout`, never both, because rendering both gives two `<Outlet/>`s
// (every page mounted twice), two `navigation` landmarks and two of every `data-testid` the e2e
// reach for.
//
// This one is the LEGACY arrangement: a single responsive shell whose sidebar collapses to icons on
// desktop and becomes a drawer on mobile. It is staged here for review, NOT adopted — nothing in
// `src/` mounts it, and it must not be wired into the router without that decision being made
// deliberately. Adopting it would mean giving up the two-shell split; keeping the split would mean
// this file eventually being deleted rather than promoted.
//
// It uses ONE `<Outlet/>`-equivalent (its `children`) and one `aside`, so it is internally
// consistent — the conflict is with the other shells, not within this one.
export const description =
  "The legacy shell: ONE responsive layout whose sidebar collapses to icons on desktop and becomes a drawer on mobile. Staged for review — the live app deliberately uses two separate shells instead.";

export interface LegacyLayoutProps {
  sections: SidebarSection[];
  sidebarHeader?: ReactNode;
  sidebarFooter?: ReactNode;
  logo?: ReactNode;
  // True while the session is still resolving — see CheckCredential.
  checkingCredentials?: boolean;
  // The viewer role every role-gated nav item is checked against. UI gating only.
  role?: Role;
  children: ReactNode;
}

function Shell({
  sections,
  sidebarHeader,
  sidebarFooter,
  logo,
  checkingCredentials,
  children,
}: LegacyLayoutProps) {
  const sidebar = useSidebar();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  // Every navigation returns the content pane to the top.
  //
  // The browser does this for free when the DOCUMENT scrolls; here the content pane scrolls instead,
  // so nothing resets it. Without this, opening a detail page from halfway down a long list drops
  // you halfway down the detail page — which reads as a broken screen, not as preserved scroll.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <Flex direction="column" height="100dvh" overflow="hidden" bg="bg.muted">
      <MobileTopbar logo={logo} />

      <Flex flex="1" minH="0" position="relative">
        {/* On mobile the sidebar is an OVERLAY, not a column: at phone width a persistent rail
            would leave the content unusably narrow. `hidden` rather than unmounted so the collapse
            preference and any scroll position survive being closed. */}
        <Box
          position={{ base: "absolute", md: "static" }}
          insetStart="0"
          top="0"
          bottom="0"
          zIndex="popover"
          display={{ base: sidebar?.expanded ? "block" : "none", md: "block" }}
          height="full"
        >
          <Sidebar sections={sections} header={sidebarHeader} footer={sidebarFooter} />
        </Box>

        {/* The scrim, mobile only. Tapping outside a drawer is how people close drawers, and without
            it the only way out is finding the X again. */}
        {sidebar?.expanded && (
          <Box
            hideFrom="md"
            position="absolute"
            inset="0"
            zIndex="overlay"
            bg="blackAlpha.500"
            onClick={sidebar.closeExpanded}
            data-testid="sidebar-scrim"
          />
        )}

        <Box
          ref={scrollRef}
          as="main"
          flex="1"
          minW="0"
          overflowY="auto"
          p={{ base: "3", md: "page" }}
          data-testid="layout-content"
        >
          <CheckCredential checking={checkingCredentials}>{children}</CheckCredential>
          <ScrollTop scrollRef={scrollRef} />
        </Box>
      </Flex>
    </Flex>
  );
}

export function LegacyLayout(props: LegacyLayoutProps & { initialCollapsed?: boolean }) {
  const { initialCollapsed, role, ...rest } = props;

  return (
    <SidebarProvider initialCollapsed={initialCollapsed} role={role}>
      <Shell {...rest} role={role} />
    </SidebarProvider>
  );
}
