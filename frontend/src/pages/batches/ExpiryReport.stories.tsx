import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, waitFor, within } from "storybook/test";

import { productPlacesForStory } from "../../../.storybook/batchStub";
import { LocationProbe, asTeam, besideTheOpenSidebar, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { BatchesPage } from "./index";

// THE EXPIRY REPORT IS THE BATCH LIST (owner: *"A"*, the-expiry-report-is-the-batch-list; accepted as shown,
// the-expiry-prototypes-are-accepted): no new screen. The crew filters the Batch list *Kedaluwarsa ≤ 30 hari* and each
// row names the racks its PRODUCT sits on in this warehouse — where the product is now (product_placements: a rack
// counts per product, never per batch), carried by the list's own read (`StockBatch.rack_codes`). A desktop row's last
// column, *Rak*: its first two racks and how many more (all on its hover); a phone's block a line naming every rack. A
// batch with nothing left (Habis) names none — there is nothing of it to find.
//
// Gudang Pusat (11), where the products sit as this story sets it (batchStub `productPlacesForStory`):
//
//   Kopi 71   A-01-1 14 · A-01-2 4 · B-02-1 2     batches 3982 (9 days left), 9101 (return, no expiry)
//   Beras 74  A-01-1 5 · B-02-1 2                 batch 5031 (20 days left)
//   Gula 73   B-02-1 5                            batch 3981 (expired 3 days ago)
//   Teh 72    A-01-2 17                           batches 5032 (150 days), 5071 (Habis)

const A_01_1 = 41n;
const A_01_2 = 42n;
const B_02_1 = 43n;

const PLACES_NOW = {
  "71": [
    [A_01_1, 14n],
    [A_01_2, 4n],
    [B_02_1, 2n],
  ],
  "74": [
    [A_01_1, 5n],
    [B_02_1, 2n],
  ],
  "73": [[B_02_1, 5n]],
  "72": [[A_01_2, 17n]],
} satisfies Record<string, [bigint, bigint][]>;

const routes = [
  { path: "/inventories/batches", element: <BatchesPage /> },
  { path: "/inventories/batches/:batchId", element: <LocationProbe /> },
  { path: "/inventories/restock/:requestId", element: <Text data-testid="at-restock-detail">at-restock-detail</Text> },
];
// Built ONCE, at module scope (pageStory.tsx): the whole list, and the list opened on Kedaluwarsa ≤ 30 hari (`expiry=1`).
const All = routedPage(routes, "/inventories/batches");
const Expiring = routedPage(routes, "/inventories/batches?expiry=1");

/** The 390px phone the blocks are judged at. */
const PHONE_VIEWPORTS = {
  phone390: { name: "Phone 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
};

const meta = {
  title: "Pages/Inventory/Batches/BatchList/Expiry report",
  component: Expiring,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
    productPlacesForStory(PLACES_NOW);
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement, firstRow = "batches-row-5031") {
  const canvas = within(canvasElement);
  await canvas.findByTestId(firstRow, {}, { timeout: 4000 });
  return canvas;
}

/** The three expiring batches — the soon two and the expired one; nothing that expires later, nothing emptied. */
async function expectTheExpiringRows(canvas: ReturnType<typeof within>) {
  await waitFor(() => expect(canvas.queryByTestId("batches-row-5032")).toBeNull());
  await expect(canvas.getByTestId("batches-row-5031")).toBeInTheDocument();
  await expect(canvas.getByTestId("batches-row-3982")).toBeInTheDocument();
  await expect(canvas.getByTestId("batches-row-3981")).toBeInTheDocument();
  await expect(canvas.getByTestId("batches-stat-expiring")).toHaveTextContent("3");
}

/**
 * KEDALUWARSA ≤ 30 HARI IS THE REPORT — 1440 beside the open sidebar: the three expiring batches, each naming its
 * product's racks in the last column, and the page never scrolls sideways.
 */
export const ExpiringWithRacks: Story = {
  name: "Expiring · each row names its racks (1440 beside the sidebar)",
  globals: { viewport: { value: "desktop1440" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(1440);
    await expectTheExpiringRows(canvas);

    // Rak is the last column, after Kedaluwarsa.
    const headers = within(canvas.getByTestId("batches-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    await expect(headers.at(-1)).toBe("Racks");
    await expect(headers.at(-2)).toBe("Expiring");

    // The PRODUCT's racks, in pick-walk order — two named, the rest counted, every one on its hover.
    await waitFor(() => expect(canvas.getByTestId("batches-racks-5031")).toHaveTextContent("A-01-1, B-02-1"));
    const kopi = canvas.getByTestId("batches-racks-3982");
    await expect(kopi).toHaveTextContent("A-01-1, A-01-2+1");
    await expect(kopi).toHaveAttribute("title", "A-01-1, A-01-2, B-02-1");
    await expect(canvas.getByTestId("batches-racks-3981")).toHaveTextContent("B-02-1");
    // Beside how long is left.
    await expect(canvas.getByTestId("batches-expiry-5031-left")).toHaveAttribute("data-band", "soon");
    await expect(canvas.getByTestId("batches-expiry-3981-left")).toHaveAttribute("data-band", "past");

    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/** A PHONE — each block names every rack its product sits on, on a line of its own; nothing runs past the edge. */
export const Phone: Story = {
  name: "Phone · each block names its racks",
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(390);
    await expectTheExpiringRows(canvas);

    const kopi = canvas.getByTestId("batches-row-3982");
    await waitFor(() => expect(within(kopi).getByTestId("batches-racks-3982")).toHaveTextContent("Racks A-01-1, A-01-2, B-02-1"));
    await expect(within(canvas.getByTestId("batches-row-3981")).getByTestId("batches-racks-3981")).toHaveTextContent(
      "Racks B-02-1",
    );
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/**
 * THE WHOLE LIST — the column is on every row, not only under the filter; a batch with nothing left (5071, Habis) names
 * no rack, though its tea still sits on A-01-2 for the other batch.
 */
export const EveryRowAndHabis: Story = {
  name: "Every row · Habis names none",
  render: () => <All />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("batches-racks-5032")).toHaveTextContent("A-01-2"));
    await expect(canvas.getByTestId("batches-racks-5071")).toHaveTextContent("—");
  },
};

/** A PRODUCT ON NO RACK — its batch still has units, but no rack holds the product now: the cell reads a dash. */
export const AProductOnNoRack: Story = {
  name: "A product on no rack · —",
  beforeEach: () => {
    productPlacesForStory({ ...PLACES_NOW, "74": [] });
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("batches-racks-3982")).toHaveTextContent("A-01-1, A-01-2+1"));
    await expect(canvas.getByTestId("batches-racks-5031")).toHaveTextContent("—");
  },
};
