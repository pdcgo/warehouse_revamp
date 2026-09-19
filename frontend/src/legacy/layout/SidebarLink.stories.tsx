import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Stack } from "@chakra-ui/react";
import { Boxes, Receipt, Truck } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { SidebarLink, description } from "./SidebarLink";
import { SidebarProvider } from "./SidebarContext";

const meta = {
  title: "Legacy/Layout/SidebarLink",
  component: SidebarLink,
  parameters: {
    docs: { description: { component: description } },
    // This story owns its router so it can control the current path — the decorator's default
    // MemoryRouter always sits at "/".
    dataRouter: true,
  },
  args: { item: { href: "/stock", name: "Stock", icon: Boxes } },
} satisfies Meta<typeof SidebarLink>;

export default meta;
type Story = StoryObj<typeof meta>;

function At({
  path,
  collapsed,
  role,
  children,
}: {
  path: string;
  collapsed?: boolean;
  role?: Role;
  children: React.ReactNode;
}) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider initialCollapsed={collapsed} role={role}>
        <Box w="60" borderWidth="1px" p="2">
          <Stack gap="1">{children}</Stack>
        </Box>
      </SidebarProvider>
    </MemoryRouter>
  );
}

export const Default: Story = {
  render: (args) => (
    <At path="/orders">
      <SidebarLink {...args} />
    </At>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("sidebar-link-Stock")).not.toHaveAttribute("data-current");
  },
};

// ⚠ CURRENT IS A LONGEST-PREFIX MATCH, NOT EQUALITY. Equality would un-highlight the nav the moment
// you opened a detail page — exactly when the reader most needs to know where they are.
export const StaysCurrentOnADetailRoute: Story = {
  render: (args) => (
    <At path="/stock/4471">
      <SidebarLink {...args} />
    </At>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const link = canvas.getByTestId("sidebar-link-Stock");
    await expect(link).toHaveAttribute("data-current", "true");
    // Announced, not just tinted.
    await expect(link).toHaveAttribute("aria-current", "page");
  },
};

// "/" as a prefix would match every route, so the root link is special-cased to an exact match.
export const RootOnlyMatchesExactly: Story = {
  render: () => (
    <At path="/stock">
      <SidebarLink item={{ href: "/", name: "Dashboard", icon: Receipt }} />
      <SidebarLink item={{ href: "/stock", name: "Stock", icon: Boxes }} />
    </At>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("sidebar-link-Dashboard")).not.toHaveAttribute("data-current");
    await expect(canvas.getByTestId("sidebar-link-Stock")).toHaveAttribute("data-current", "true");
  },
};

// Past 99 the exact number has stopped being actionable — "a lot" is the whole message, and a
// four-digit count would burst the fixed-size badge.
export const CountOverflows: Story = {
  render: () => (
    <At path="/">
      <SidebarLink item={{ href: "/orders", name: "Orders", icon: Receipt, count: 12 }} />
      <SidebarLink item={{ href: "/picking", name: "Picking", icon: Truck, count: 1240 }} />
    </At>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("sidebar-count-Orders")).toHaveTextContent("12");
    await expect(canvas.getByTestId("sidebar-count-Picking")).toHaveTextContent("99+");
  },
};

// Collapsed, the label becomes a tooltip — a tooltip repeating a VISIBLE label would be noise, so it
// only appears once the label is gone.
export const CollapsedShowsATooltip: Story = {
  render: (args) => (
    <At path="/" collapsed>
      <SidebarLink {...args} />
    </At>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.hover(canvas.getByTestId("sidebar-link-Stock"));
    await waitFor(async () => {
      await expect(screen.getByTestId("tooltip-content")).toHaveTextContent("Stock");
    });
  },
};

// Role gating — UI ONLY. Hiding a link hides nothing; the access interceptor is the real boundary.
export const RoleGating: Story = {
  render: () => (
    <At path="/" role={Role.WAREHOUSE_STAFF}>
      <SidebarLink item={{ href: "/stock", name: "Stock", icon: Boxes }} />
      <SidebarLink item={{ href: "/billing", name: "Billing", icon: Receipt, roles: [Role.ADMIN] }} />
    </At>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("sidebar-link-Stock")).toBeVisible();
    await expect(canvas.queryByTestId("sidebar-link-Billing")).toBeNull();
  },
};

// A role list with NO viewer role yet resolves to hidden — better a missing link for a beat than one
// that flashes in and then disappears as the session lands.
export const UnknownRoleHidesGatedLinks: Story = {
  render: () => (
    <At path="/">
      <SidebarLink item={{ href: "/billing", name: "Billing", icon: Receipt, roles: [Role.ADMIN] }} />
    </At>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("sidebar-link-Billing")).toBeNull();
  },
};
