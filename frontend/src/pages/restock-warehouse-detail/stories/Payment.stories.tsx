import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { At503, WAREHOUSE_DETAIL_META, loaded } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the total, and the courier's charge this warehouse paid at the door.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Payment",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// the-couriers-charge-stays-out-of-total — the total is goods + shipping; the 5.000 this warehouse paid at the door is
// shown on its own, owed back by the selling team.
export const TheCouriersChargeIsOwedBack: Story = {
  name: "Courier's charge owed back",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-total")).toHaveTextContent("Rp 980.000");
    await expect(canvas.getByTestId("restock-detail-courier-charge")).toHaveTextContent("Rp 5.000");
    await expect(canvas.getByTestId("restock-detail-courier-charge-note")).toHaveTextContent("Ongkos bongkar di gudang");
  },
};
