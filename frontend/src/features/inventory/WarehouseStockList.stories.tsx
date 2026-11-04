import type { Meta, StoryObj } from "@storybook/react-vite";
import { useParams } from "react-router-dom";
import { Text } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam, asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { WarehouseStockList, description } from "./WarehouseStockList";

// WHAT A WAREHOUSE HOLDS, on its own (the-stock-screen-lists-what-the-warehouse-has-held) — the list a warehouse's Products
// and root/admin's Inventory both draw (a-warehouses-products-is-what-it-holds). Gudang Pusat (11), served by
// warehouseStockListStub.ts; the pages' stories pin their headers, this one the list's own rules:
//
//   | story                          | the rule it pins                                                         |
//   | ------------------------------ | ------------------------------------------------------------------------ |
//   | Default                        | a row opens the warehouse product page of THAT product (`opensProduct`)   |
//   | Mobile                         | a block per product; the block opens, its ⋯ does not                       |
//   | ActionsDoNotOpenTheRow         | Move, picked from the ⋯, opens its dialog and not the row                  |
//   | WithoutOpensProductRowsStay    | without `opensProduct` a row opens nothing — root/admin's Inventory        |
//   | AMonitorIsOfferedNoActions     | the admin team reads: no ⋯, the rows still listed                          |

function AtWarehouseProduct() {
  const { productId } = useParams();
  return <Text data-testid="at-warehouse-product">{productId}</Text>;
}

const routed = (opensProduct: boolean) =>
  routedPage(
    [
      {
        path: "/list",
        element: (
          <>
            <WarehouseStockList warehouseId={11n} opensProduct={opensProduct} />
            <LocationProbe />
          </>
        ),
      },
      { path: "/inventories/products/:productId", element: <AtWarehouseProduct /> },
    ],
    "/list",
  );

const Opening = routed(true);
const Staying = routed(false);

const meta = {
  title: "Features/Inventory/WarehouseStockList",
  component: Opening,
  parameters: { signedIn: true, dataRouter: true, docs: { description: { component: description } } },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("stock-row-SKU-GULA-1K", {}, { timeout: 4000 });
  return canvas;
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("stock-owner-SKU-GULA-1K")).toHaveTextContent("Toko Kenanga");
    await expect(canvas.getByTestId("stock-onhand-SKU-GULA-1K")).toHaveTextContent("12");

    await userEvent.click(canvas.getByText("Gula Pasir 1kg"));
    await expect(await canvas.findByTestId("at-warehouse-product")).toHaveTextContent("73");
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByRole("table")).toBeNull();
    const gula = within(canvas.getByTestId("stock-row-SKU-GULA-1K"));

    await userEvent.click(gula.getByTestId("row-actions-SKU-GULA-1K"));
    await waitFor(() => expect(screen.getByTestId("move-SKU-GULA-1K")).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByTestId("at-warehouse-product")).toBeNull();

    await userEvent.click(gula.getByText("Gula Pasir 1kg"));
    await expect(await canvas.findByTestId("at-warehouse-product")).toHaveTextContent("73");
  },
};

export const ActionsDoNotOpenTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("row-actions-SKU-GULA-1K"));
    const move = await screen.findByTestId("move-SKU-GULA-1K");
    await waitFor(() => expect(move).toBeVisible());
    await userEvent.click(move);

    await expect(await screen.findByTestId("move-quantity")).toBeVisible();
    await expect(canvas.queryByTestId("at-warehouse-product")).toBeNull();
  },
};

export const WithoutOpensProductRowsStay: Story = {
  render: () => <Staying />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByText("Gula Pasir 1kg"));
    await expect(canvas.queryByTestId("at-warehouse-product")).toBeNull();
    await expect(canvas.getByTestId("stock-row-SKU-GULA-1K")).toBeVisible();
  },
};

export const AMonitorIsOfferedNoActions: Story = {
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("stock-row-SKU-BERAS-5K")).toBeVisible();
    await expect(canvas.queryByTestId("row-actions-SKU-GULA-1K")).toBeNull();
  },
};
