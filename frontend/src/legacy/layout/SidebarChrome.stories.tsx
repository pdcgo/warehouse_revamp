import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Stack } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  SidebarCollapseToggle,
  SidebarLimit,
  SidebarLogo,
  SidebarLogout,
  SidebarUser,
  limitDescription,
  logoDescription,
  userDescription,
} from "./SidebarChrome";
import { SidebarProvider } from "./SidebarContext";

const meta = {
  title: "Legacy/Layout/SidebarChrome",
  component: SidebarLogo,
  parameters: { docs: { description: { component: logoDescription } } },
} satisfies Meta<typeof SidebarLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

function Rail({ collapsed, children }: { collapsed?: boolean; children: React.ReactNode }) {
  return (
    <SidebarProvider initialCollapsed={collapsed}>
      <Box w={collapsed ? "16" : "56"} borderWidth="1px" bg="bg.subtle">
        <Stack gap="0">{children}</Stack>
      </Box>
    </SidebarProvider>
  );
}

const Pieces = (
  <>
    <SidebarLogo name="Warehouse" addon="v2" />
    <SidebarUser name="Ani Rahayu" roleLabel="Warehouse Staff" />
    <SidebarLimit unpaid={44_000_000n} threshold={50_000_000n} />
    <SidebarCollapseToggle />
    <SidebarLogout />
  </>
);

export const Expanded: Story = { render: () => <Rail>{Pieces}</Rail> };

// The rule every piece here shares: each one decides for ITSELF what survives at icon width. The
// alternative — narrowing the container and letting the contents clip — is a strip with half a
// wordmark and a user block showing nothing.
export const CollapsedFormOfEachPiece: Story = {
  parameters: { docs: { description: { story: userDescription } } },
  render: () => <Rail collapsed>{Pieces}</Rail>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const id of ["sidebar-logo", "sidebar-user", "sidebar-limit", "sidebar-logout"]) {
      await expect(canvas.getByTestId(id)).toBeVisible();
    }
  },
};

// The limit meter is the sidebar's standing warning that ordering is about to stop. With NO limit
// configured there is nothing to warn about, so it is absent rather than showing an empty bar.
export const NoLimitConfiguredHidesTheMeter: Story = {
  parameters: { docs: { description: { story: limitDescription } } },
  render: () => (
    <Rail>
      <SidebarLimit unpaid={0n} threshold={0n} />
    </Rail>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("sidebar-limit")).toBeNull();
  },
};

// The collapse toggle is a PREFERENCE — it persists, so an operator who wants room for a wide table
// sets it once.
export const CollapseTogglePersists: Story = {
  render: () => <Rail>{Pieces}</Rail>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("sidebar-collapse"));

    await waitFor(async () => {
      await expect(localStorage.getItem("legacy-sidebar-collapsed")).toBe("true");
    });
  },
};
