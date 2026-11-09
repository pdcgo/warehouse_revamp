import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { ADMIN_TEAM, asAdminTeam, asPlatformOnly, asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ROOT_TEAM_ID } from "../../features/team/TeamContext";
import { StockForward } from "./StockForward";

// THE OLD STOCK ADDRESS FORWARDS (a-warehouses-products-is-what-it-holds): /inventories/stock is no screen of its own any
// more. A warehouse lands on its Products — the list of what it holds — and anyone else on /inventory, root and the admin
// team's Inventory. The query rides along. Each destination is a marker that shows the query it arrived with.

function Arrived({ testId }: { testId: string }) {
  return (
    <>
      <Text data-testid={testId}>{testId}</Text>
      <LocationProbe />
    </>
  );
}

const Routed = routedPage(
  [
    { path: "/inventories/stock", element: <StockForward /> },
    { path: "/products", element: <Arrived testId="at-products" /> },
    { path: "/inventory", element: <Arrived testId="at-inventory" /> },
  ],
  "/inventories/stock?q=beras",
);

const meta = {
  title: "Pages/Inventory/StockForward",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// A warehouse's Admin with the old address open lands on the warehouse's Products, the search kept.
export const AWarehouseLandsOnProducts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("at-products", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("q=beras");
    await expect(canvas.queryByTestId("at-inventory")).toBeNull();
  },
};

// The admin team's monitor, in its own team, lands on the Inventory it has in its menu. (Reading a warehouse, it would
// land on that warehouse's Products — the current team decides.)
export const AMonitorLandsOnInventory: Story = {
  beforeEach: () => {
    asTeam(ADMIN_TEAM.id)();
    asAdminTeam()();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("at-inventory", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("q=beras");
  },
};

// Root, in the root team, lands on Inventory too.
export const RootLandsOnInventory: Story = {
  beforeEach: () => {
    asTeam(ROOT_TEAM_ID)();
    asPlatformOnly(Role.ROOT)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("at-inventory", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.queryByTestId("at-products")).toBeNull();
  },
};
