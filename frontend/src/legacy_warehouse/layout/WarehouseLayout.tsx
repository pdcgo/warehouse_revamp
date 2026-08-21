import { type ReactNode, useState } from "react";
import { Box, Drawer, Flex, IconButton, Icon, Portal, Text, useBreakpointValue } from "@chakra-ui/react";
import { Menu, Warehouse } from "lucide-react";
import { WarehouseSidebar } from "./WarehouseSidebar";
import type { FloorUser } from "./UserCard";

// ── THE FLOOR SHELL ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ THIS IS A THIRD SHELL, AND IT IS NOT THE APP'S SHELL.
//
// The live app already has two (`src/layouts/`), picked by a JS breakpoint — never both, because
// rendering both gives two `<Outlet/>`s, two `navigation` landmarks and two of every `data-testid`
// the e2e reach for. This one is a REFERENCE: nothing in `src/` mounts it, and it exists to be read
// beside the other two, not to be added to them.
//
// ── WHAT IS DIFFERENT ABOUT IT, AND WHY ─────────────────────────────────────────────────────────
//
// It is one shell that collapses, not two shells picked by breakpoint — and that is right for THIS
// app for a reason that does not hold for the selling app:
//
//   The floor app's small screen is a TABLET IN LANDSCAPE on a trolley, not a phone in a hand. It
//   has room for a table; it does not have room for a permanent 270px sidebar. So the answer is the
//   same screen with the menu pulled out on demand — a drawer — rather than a different screen with
//   a thumb-reachable bottom bar. There is no thumb: the operator is holding a scanner.
//
// This is why the live app's two-shell rule and this one's single collapsing shell are both correct.
// The shell follows the posture of the device, and the postures are different.
export const description =
  "The warehouse floor shell: one collapsing shell (sidebar → drawer), not two shells by breakpoint. The small screen here is a trolley tablet, not a phone in a hand — so there is no thumb to reach a bottom bar.";

const SIDEBAR_WIDTH = "17rem";

export interface WarehouseLayoutProps {
  pathname?: string;
  user?: FloorUser;
  badges?: Record<string, number>;
  children?: ReactNode;
  onSignOut?(): void;
  // Which arrangement to render. "auto" reads the breakpoint and is what the app uses; the two
  // explicit values exist because the story runner has ONE fixed viewport, so whichever arrangement
  // it does not happen to land in would never be reviewable or testable.
  arrangement?: "auto" | "wide" | "compact";
}

export function WarehouseLayout({
  pathname = "/",
  user,
  badges,
  children,
  onSignOut,
  arrangement = "auto",
}: WarehouseLayoutProps) {
  const [open, setOpen] = useState(false);
  const autoWide = useBreakpointValue({ base: false, xl: true }, { ssr: false });
  const compact = arrangement === "auto" ? !autoWide : arrangement === "compact";

  const sidebar = (
    <WarehouseSidebar
      pathname={pathname}
      user={user}
      badges={badges}
      onSignOut={onSignOut}
      onNavigate={() => setOpen(false)}
    />
  );

  return (
    <Flex direction={compact ? "column" : "row"} h="100dvh" overflow="hidden" data-testid="warehouse-layout">
      {compact ? (
        <>
          <Flex align="center" justify="space-between" px="2" py="2" borderBottomWidth="1px" gap="2">
            <Drawer.Root open={open} onOpenChange={(e) => setOpen(e.open)} placement="start">
              <Drawer.Trigger asChild>
                <IconButton size="sm" variant="outline" aria-label="Open menu" data-testid="open-menu">
                  <Icon as={Menu} boxSize="4" />
                </IconButton>
              </Drawer.Trigger>
              <Portal>
                <Drawer.Backdrop />
                <Drawer.Positioner>
                  <Drawer.Content maxW={SIDEBAR_WIDTH}>{sidebar}</Drawer.Content>
                </Drawer.Positioner>
              </Portal>
            </Drawer.Root>

            <Text fontWeight="medium" fontSize="sm">
              <Icon as={Warehouse} boxSize="4" mr="1.5" verticalAlign="-2px" />
              Warehouse Admin
            </Text>
            <Box w="8" />
          </Flex>

          <Box flex="1" overflow="auto" bg="bg.subtle" data-testid="floor-content">
            {children}
          </Box>
        </>
      ) : (
        <>
          {/* ⚠ ONE `navigation` LANDMARK. The drawer above and this aside are the SAME sidebar in the
              same position of the tree — the compact branch renders one or the other, never both.
              Hiding one with CSS instead would give the page two navigations and two of every
              test id inside them. */}
          <Box as="aside" w={SIDEBAR_WIDTH} flexShrink={0} borderRightWidth="1px" overflow="hidden">
            {sidebar}
          </Box>

          <Box flex="1" overflow="auto" bg="bg.subtle" data-testid="floor-content">
            {children}
          </Box>
        </>
      )}
    </Flex>
  );
}
