import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { BulkPickPage } from "./index";
import { DESKTOP, KAOS_HITAM, KAOS_PUTIH, KEMEJA, PHONE, SCENE_PATH, TOPI, VIEWPORTS, bulkPickPage, bulkPickScene, fitsTheScreen, loaded } from "./stories/kit";

// THE BULK PICK LIST — `/warehouse-orders/bulk-pick?ids=…` (the-bulk-pick-list-prototype-is-accepted). The page runs its
// real reads against the stub transport (.storybook/bulkPickStub.ts). The parts' stories are in `stories/`
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   | file                     | what it pins                                                                   |
//   | ------------------------ | ------------------------------------------------------------------------------ |
//   | index (this)             | Default — Per Produk on a desktop · Mobile — the same on a 390 phone           |
//   | stories/ByProduct        | each product's total and racks, the unplaced pile and unrecorded units said,   |
//   |                          | walk order, the orders stay Dikonfirmasi (no move anywhere), the phone blocks  |
//   | stories/ByOrder          | each order's products and racks, the tab in the address, Buka → its pick page, |
//   |                          | Back where it was opened, no ids, the phone blocks                             |
//   | stories/Entry            | the Dikonfirmasi tab's bar: Daftar Ambil waits for a tick, opens the ticked    |
//   |                          | ones, skips what is not Dikonfirmasi, keeps every other action                 |
//   | stories/Reads            | one OrderPickLines + one many-take StockPickLocations for the ids, another     |
//   |                          | building's order not listed, a failed read said                                |

const Page = bulkPickPage(SCENE_PATH);

const meta = {
  title: "Pages/Warehouse/BulkPick",
  component: BulkPickPage,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: VIEWPORTS } },
  beforeEach: bulkPickScene,
  render: () => <Page />,
} satisfies Meta<typeof BulkPickPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** PER PRODUK on a desktop — the page opens on it: four products in walk order, 12 units over 5 orders. */
export const Default: Story = {
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("bulk-pick-count")).toHaveTextContent("5 orders · 12 units");
    await expect(canvas.getByTestId("bulk-pick-by-product")).toHaveAttribute("data-layout", "table");
    for (const id of [KAOS_HITAM, TOPI, KAOS_PUTIH, KEMEJA]) {
      await expect(canvas.getByTestId(`bulk-pick-product-${id}`)).toBeInTheDocument();
    }
    await fitsTheScreen();
  },
};

/** THE SAME ON A 390 PHONE — one block per product, its total big on the right, its racks under it. */
export const Mobile: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("bulk-pick-by-product")).toHaveAttribute("data-layout", "blocks");
    await expect(canvas.getByTestId(`bulk-pick-product-total-${KAOS_HITAM}`)).toHaveTextContent("5");
    await fitsTheScreen();
  },
};
