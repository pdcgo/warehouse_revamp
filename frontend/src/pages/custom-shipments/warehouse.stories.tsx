import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { PHONE, ReadProbe, WAREHOUSE_META, warehouseAt } from "../../features/customShipment/storyKit";
import { fitsTheScreen } from "../../features/warehouseTransfer/storyPhone";

// ⚠ PROTOTYPE (backlog #88) — THE WAREHOUSE'S QUEUE of custom shipments: every parcel Gudang Pusat (11) ships, whichever
// team asked (the-selling-team-asks-the-warehouse-ships — the warehouse picks, packs and hands over). It reads no seller
// money (a-warehouse-sees-no-seller-money) and of a *Kami bayar* ongkir only that it is the team's
// (the-warehouse-sees-the-ongkir-it-paid). Toko Melati's 806 ships from Gudang Cabang, so it is not here.

const Routed = warehouseAt("/inventories/custom-shipments");

const meta = {
  title: "Pages/Inventory/CustomShipment/WarehouseQueue",
  component: Routed,
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("custom-shipment-row-801", {}, { timeout: 4000 });
  return canvas;
}

const rowIds = (canvasElement: HTMLElement) =>
  Array.from(within(canvasElement).getByTestId("custom-shipments-table").querySelectorAll("[data-testid^='custom-shipment-row-']")).map(
    (row) => row.getAttribute("data-testid")!.replace("custom-shipment-row-", ""),
  );

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("custom-shipments-warehouse")).toBeVisible();
    await expect(rowIds(canvasElement).sort()).toEqual(["801", "802", "803", "804", "805", "807", "808"]);
    // Whose parcel each is — another team's too.
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-other-807")).toHaveTextContent("Toko Kenanga"));
    await expect(canvas.getByTestId("custom-shipment-other-801")).toHaveTextContent("Toko Melati");

    // NO MONEY BUT ITS OWN: no value column, no ⋯ (the team's acts), no Paket Baru.
    await expect(canvas.queryByTestId("custom-shipment-value-801")).toBeNull();
    await expect(canvas.queryByTestId("custom-shipment-actions-801")).toBeNull();
    await expect(canvas.queryByTestId("open-create-custom-shipment")).toBeNull();
    await expect(canvas.getByTestId("custom-shipment-pay-802")).toHaveTextContent("Paid by the team");
    await expect(canvas.getByTestId("custom-shipment-pay-802")).not.toHaveTextContent("18.000");
    await expect(canvas.getByTestId("custom-shipment-pay-804")).toHaveTextContent("Warehouse paid Rp 12.000");
  },
};

export const Mobile: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("custom-shipments-table")).toHaveAttribute("data-layout", "phone");
    await expect(canvas.getByRole("heading", { name: "Parcels to Ship" })).toBeVisible();
    await expect(canvas.queryByTestId("open-create-custom-shipment")).toBeNull();
    await fitsTheScreen(canvasElement);
  },
};

// The Requested tab is the work waiting — the reship among the samples.
export const TheRequestedTabIsTheWorkWaiting: Story = {
  name: "The requested tab is the work waiting",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-tab-requested"));
    await waitFor(() => expect(rowIds(canvasElement).sort()).toEqual(["801", "803", "807"]));
  },
};

// A row opens its pick page.
export const ARowOpensItsPickPage: Story = {
  name: "A row opens its pick page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-row-801"));
    await expect(await canvas.findByTestId("custom-shipment-pick-page")).toBeVisible();
  },
};

// THE WAREHOUSE'S READ CARRIES NO SELLER MONEY — not only undrawn: the sample's value and the team's own ongkir and account
// are unset in what the warehouse is answered (a-warehouse-sees-no-seller-money, the-warehouse-sees-the-ongkir-it-paid);
// the ongkir it paid itself (804) is its own.
export const TheWarehousesReadCarriesNoSellerMoney: Story = {
  name: "The warehouse's read carries no seller money",
  render: () => (
    <>
      <Routed />
      <ReadProbe id={802n} />
      <ReadProbe id={804n} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(JSON.parse(canvas.getByTestId("read-probe-802").textContent ?? "")).toEqual({
      total: 0,
      itemTotals: [0, 0],
      financeAccountId: "0",
      shippingCost: 0,
    });
    await expect(JSON.parse(canvas.getByTestId("read-probe-804").textContent ?? "")).toMatchObject({ total: 0, shippingCost: 12000 });
  },
};
