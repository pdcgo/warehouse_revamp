import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Box } from "@chakra-ui/react";
import { Boxes, Receipt, Wallet } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SidebarLinkGroup, description } from "./SidebarLinkGroup";
import { SidebarProvider } from "./SidebarContext";
import type { SidebarLinkItem } from "./SidebarLink";

const ITEMS: SidebarLinkItem[] = [
  { href: "/stock", name: "Stock", icon: Boxes },
  {
    href: "/billing",
    name: "Billing",
    icon: Wallet,
    submenu: [
      { href: "/billing/payable", name: "Supplier bills", icon: Wallet, group: "Payable" },
      { href: "/billing/payouts", name: "Payouts", icon: Wallet, group: "Payable" },
      { href: "/billing/receivable", name: "Customer invoices", icon: Receipt, group: "Receivable" },
    ],
  },
  {
    href: "/orders",
    name: "Orders",
    icon: Receipt,
    submenu: [{ href: "/orders/draft", name: "Drafts", icon: Receipt }],
  },
];

const meta = {
  title: "Legacy/Layout/SidebarLinkGroup",
  component: SidebarLinkGroup,
  parameters: { docs: { description: { component: description } }, dataRouter: true },
  args: { name: "Warehouse", items: ITEMS },
} satisfies Meta<typeof SidebarLinkGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness({ path = "/", items = ITEMS }: { path?: string; items?: SidebarLinkItem[] }) {
  const [openKey, setOpenKey] = useState<string>();

  return (
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <Box w="64" borderWidth="1px">
          <SidebarLinkGroup name="Warehouse" items={items} openKey={openKey} onOpenChange={setOpenKey} />
        </Box>
      </SidebarProvider>
    </MemoryRouter>
  );
}

// ⚠ ONE SUBMENU AT A TIME, sidebar-wide. Without it every parent anyone has ever expanded stays
// expanded, and a four-section sidebar becomes a forty-item list that has to be SCROLLED to reach
// anything — which defeats the point of grouping.
export const OnlyOneSubmenuOpenAtATime: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("sidebar-toggle-Billing"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("sidebar-submenu-Billing")).toBeVisible();
    });

    await userEvent.click(canvas.getByTestId("sidebar-toggle-Orders"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("sidebar-submenu-Orders")).toBeVisible();
    });
    // Opening one closed the other.
    await expect(canvas.queryByTestId("sidebar-submenu-Billing")).toBeNull();
  },
};

// The submenu containing the current route opens ITSELF — otherwise landing on a deep link leaves
// the nav claiming you are nowhere.
export const TheSectionContainingTheRouteOpensItself: Story = {
  render: () => <Harness path="/billing/payouts" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(async () => {
      await expect(canvas.getByTestId("sidebar-submenu-Billing")).toBeVisible();
    });
    await expect(canvas.getByTestId("sidebar-link-Payouts")).toHaveAttribute("data-current", "true");
  },
};

// The chevron is a SEPARATE control from the link. The parent is itself a destination, so clicking
// its name must navigate — one element doing both is the sidebar that navigates when you meant to
// expand.
export const ChevronExpandsWithoutNavigating: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("sidebar-toggle-Billing"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("sidebar-submenu-Billing")).toBeVisible();
    });
    // Still on the original route — expanding did not navigate.
    await expect(canvas.getByTestId("sidebar-link-Billing")).not.toHaveAttribute("data-current");
  },
};

// Submenu headings group the children. A heading whose every item is hidden is DROPPED, not left as
// a lone heading over nothing.
export const HeadingWithNoVisibleItemsIsDropped: Story = {
  render: () => (
    <Harness
      items={[
        {
          href: "/billing",
          name: "Billing",
          icon: Wallet,
          submenu: [
            { href: "/billing/payable", name: "Supplier bills", icon: Wallet, group: "Payable" },
            { href: "/billing/receivable", name: "Customer invoices", icon: Receipt, group: "Receivable", hidden: true },
          ],
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("sidebar-toggle-Billing"));
    await waitFor(async () => {
      await expect(canvas.getByText("Payable")).toBeVisible();
    });
    await expect(canvas.queryByText("Receivable")).toBeNull();
  },
};
