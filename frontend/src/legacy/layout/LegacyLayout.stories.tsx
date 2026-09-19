import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text } from "@chakra-ui/react";
import { Boxes, ChartNoAxesColumn, Receipt, Settings, Truck } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Card } from "../components/display/Card";
import { LegacyLayout, description } from "./LegacyLayout";
import type { SidebarSection } from "./Sidebar";
import { SidebarCollapseToggle, SidebarLogo, SidebarLogout, SidebarUser } from "./SidebarChrome";

const SECTIONS: SidebarSection[] = [
  {
    name: "Operations",
    items: [
      { href: "/", name: "Dashboard", icon: ChartNoAxesColumn },
      { href: "/stock", name: "Stock", icon: Boxes, count: 8 },
      { href: "/picking", name: "Picking", icon: Truck },
    ],
  },
  {
    name: "Finance",
    items: [{ href: "/orders", name: "Orders", icon: Receipt }],
  },
  { items: [{ href: "/settings", name: "Settings", icon: Settings }] },
];

const meta = {
  title: "Legacy/Layout/LegacyLayout",
  component: LegacyLayout,
  parameters: { docs: { description: { component: description } }, dataRouter: true },
  args: { sections: SECTIONS, children: null },
} satisfies Meta<typeof LegacyLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: { checking?: boolean; collapsed?: boolean }) {
  return (
    <MemoryRouter initialEntries={["/stock"]}>
      <LegacyLayout
        sections={SECTIONS}
        initialCollapsed={props.collapsed}
        checkingCredentials={props.checking}
        logo={<Text fontWeight="black">Warehouse</Text>}
        sidebarHeader={
          <>
            <SidebarLogo name="Warehouse" />
            <SidebarUser name="Ani Rahayu" roleLabel="Warehouse Staff" />
          </>
        }
        sidebarFooter={
          <>
            <SidebarCollapseToggle />
            <SidebarLogout />
          </>
        }
      >
        <Stack gap="3">
          {Array.from({ length: 20 }, (_, i) => (
            <Card key={i}>
              <Text>Row {i + 1}</Text>
            </Card>
          ))}
        </Stack>
      </LegacyLayout>
    </MemoryRouter>
  );
}

// ⚠ THIS IS A SECOND SHELL, AND NOT THE APP'S. The live app mounts one of TWO shells by breakpoint;
// this is the legacy single responsive one, staged for review. Nothing in `src/` mounts it.
export const Shell: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("sidebar")).toBeVisible();
    await expect(canvas.getByTestId("layout-content")).toBeVisible();
    // ONE sidebar and ONE content pane — the failure the two-shell split exists to prevent is two of
    // each on screen at once.
    await expect(canvas.getAllByTestId("sidebar")).toHaveLength(1);
    await expect(canvas.getAllByTestId("layout-content")).toHaveLength(1);
  },
};

export const CollapsedRail: Story = {
  render: () => <Harness collapsed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
  },
};

// The shell is held back while the session resolves, so the nav does not visibly grow as roles land.
export const CheckingCredentials: Story = {
  render: () => <Harness checking />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("check-credential")).toBeVisible();
  },
};

// The mobile drawer: tapping the scrim closes it. Without one the only way out is finding the
// hamburger again, and tapping outside is how people close drawers.
export const MobileDrawerClosesOnTheScrim: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("topbar-menu"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("sidebar-scrim")).toBeVisible();
    });

    await userEvent.click(canvas.getByTestId("sidebar-scrim"));
    await waitFor(async () => {
      await expect(canvas.queryByTestId("sidebar-scrim")).toBeNull();
    });
  },
};

// Navigating closes the drawer. On a phone the sidebar covers the content, so leaving it open would
// hide the page the reader just asked for.
export const NavigatingClosesTheDrawer: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("topbar-menu"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("sidebar-scrim")).toBeVisible();
    });

    await userEvent.click(canvas.getByTestId("sidebar-link-Orders"));
    await waitFor(async () => {
      await expect(canvas.queryByTestId("sidebar-scrim")).toBeNull();
    });
  },
};
