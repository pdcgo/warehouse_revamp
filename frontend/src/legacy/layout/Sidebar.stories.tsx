import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { Boxes, ChartNoAxesColumn, Receipt, Settings, Truck, Wallet } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { expect, within } from "storybook/test";

import { Sidebar, description, type SidebarSection } from "./Sidebar";
import { SidebarProvider } from "./SidebarContext";
import { SidebarCollapseToggle, SidebarLogo, SidebarLogout, SidebarUser } from "./SidebarChrome";

const SECTIONS: SidebarSection[] = [
  {
    name: "Operations",
    items: [
      { href: "/", name: "Dashboard", icon: ChartNoAxesColumn },
      { href: "/stock", name: "Stock", icon: Boxes, count: 8 },
      { href: "/picking", name: "Picking", icon: Truck, count: 142 },
    ],
  },
  {
    name: "Finance",
    beta: true,
    items: [
      { href: "/orders", name: "Orders", icon: Receipt, isNew: true },
      {
        href: "/billing",
        name: "Billing",
        icon: Wallet,
        submenu: [
          { href: "/billing/payable", name: "Supplier bills", icon: Wallet, group: "Payable" },
          { href: "/billing/receivable", name: "Customer invoices", icon: Receipt, group: "Receivable" },
        ],
      },
    ],
  },
  { items: [{ href: "/settings", name: "Settings", icon: Settings }] },
];

const meta = {
  title: "Legacy/Layout/Sidebar",
  component: Sidebar,
  parameters: { docs: { description: { component: description } }, dataRouter: true },
  args: { sections: SECTIONS },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness({ collapsed }: { collapsed?: boolean }) {
  return (
    <MemoryRouter initialEntries={["/stock"]}>
      <SidebarProvider initialCollapsed={collapsed}>
        <Box height="600px" display="flex">
          <Sidebar
            sections={SECTIONS}
            header={
              <>
                <SidebarLogo name="Warehouse" addon="v2" />
                <SidebarUser name="Ani Rahayu" roleLabel="Warehouse Staff" />
              </>
            }
            footer={
              <>
                <SidebarCollapseToggle />
                <SidebarLogout />
              </>
            }
          />
        </Box>
      </SidebarProvider>
    </MemoryRouter>
  );
}

export const Expanded: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("sidebar")).not.toHaveAttribute("data-collapsed");
    await expect(canvas.getByTestId("sidebar-link-Stock")).toHaveAttribute("data-current", "true");
  },
};

// Collapsed, EVERY piece keeps a form — the logo keeps its mark, the user keeps the avatar, the
// links keep their icons and counts. The failure mode this guards against is a narrowed container
// whose contents simply vanish or clip.
export const CollapsedKeepsEveryPiece: Story = {
  render: () => <Harness collapsed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    await expect(canvas.getByTestId("sidebar-logo")).toBeVisible();
    await expect(canvas.getByTestId("sidebar-user")).toBeVisible();
    await expect(canvas.getByTestId("sidebar-link-Stock")).toBeVisible();
    // The pending count survives the collapse — it moves to the icon's corner rather than dropping.
    await expect(canvas.getByTestId("sidebar-count-Stock")).toBeVisible();
    await expect(canvas.getByTestId("sidebar-logout")).toBeVisible();
  },
};

// One `navigation`/`aside` landmark. ⚠ Two on screen at once is the failure the app's two-shell
// split exists to prevent — this shell must never be mounted beside another one.
export const OneLandmark: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("sidebar")).toHaveLength(1);
  },
};
