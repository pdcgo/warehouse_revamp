import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { asPlatformOnly, asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { At43, RACK_DETAIL_META, loaded, stock } from "./kit";

// RACK DETAIL — the shelf, Produk: when there is nothing on it, and whose money it shows. The page's stories are grouped
// by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.
//
// A WAREHOUSE READS A SHELF IN UNITS ONLY (a-warehouse-sees-ready-value-but-a-shelf-only-units): the server leaves the
// money unset for a caller acting with a warehouse role, and the page draws none of it — no Harga/pcs or Nilai column, no
// value under the tile's units, no price line in a phone's block; never an empty column or a Rp 0. Root, from outside
// the warehouse, reads all of it. A-01-1 (41): Kopi 12 × Rp 18.500, Gula 5 × Rp 14.000, Beras 8 × Rp 65.000 = Rp 812.000.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/Shelf",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Root (or the Administrator), a member of the root team only, reading Gudang Pusat's rack from outside it. */
const asRootFromOutside = () => {
  asTeam(11n)();
  asPlatformOnly(Role.ROOT, [])();
};

// The shelf's figures carry no rupiah anywhere: the card strip and the whole Produk section.
async function noRupiahOnTheShelf(canvas: ReturnType<typeof within>) {
  await expect(canvas.getByTestId("rack-summary")).not.toHaveTextContent("Rp");
  await expect(canvas.getByTestId("rack-products-panel")).not.toHaveTextContent("Rp");
  await expect(canvas.queryByTestId("rack-summary-value")).toBeNull();
  await expect(canvas.queryByTestId("rack-summary-unknown-cost")).toBeNull();
  for (const id of [71, 73, 74]) {
    await expect(stock(canvas).queryByTestId(`rack-unit-cost-${id}`)).toBeNull();
    await expect(stock(canvas).queryByTestId(`rack-line-value-${id}`)).toBeNull();
  }
}

// A WAREHOUSE'S SHELF, IN UNITS — its Owner, the highest warehouse role, reads Produk · Tim · Di rak ini and nothing past
// it; the tile is the units alone.
export const AWarehouseReadsUnitsOnly: Story = {
  name: "A warehouse reads units only",
  beforeEach: () => {
    asRole(Role.WAREHOUSE_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("12"));
    await expect(canvas.getByTestId("rack-summary-count")).toHaveTextContent("25 units");
    // Three columns — no empty money columns left behind.
    const headers = within(canvas.getByTestId("rack-detail-stock")).getAllByRole("columnheader");
    await expect(headers.map((h) => h.textContent)).toEqual(["Product", "Team", "On this rack"]);
    await noRupiahOnTheShelf(canvas);
  },
};

// …and on a phone — staff this time: each block is the product, whose it is and *Di rak ini 12*, with no price line.
export const AWarehouseReadsUnitsOnlyOnAPhone: Story = {
  name: "A warehouse reads units only, phone",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("12"));
    await expect(canvas.getByTestId("rack-summary-count")).toHaveTextContent("25 units");
    for (const id of [71, 73, 74]) {
      await expect(stock(canvas).queryByTestId(`rack-line-price-${id}`)).toBeNull();
    }
    await expect(stock(canvas).getByTestId("rack-stock-row-71")).not.toHaveTextContent("×");
    await noRupiahOnTheShelf(canvas);
  },
};

// ROOT KEEPS EVERY FIGURE — from outside Gudang Pusat (no role there), the tile's value and Harga/pcs · Nilai, as before.
export const RootReadsTheValue: Story = {
  name: "Root reads the value",
  beforeEach: asRootFromOutside,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-unit-cost-71")).toHaveTextContent("Rp 18.500"));
    await expect(stock(canvas).getByTestId("rack-line-value-71")).toHaveTextContent("Rp 222.000");
    await expect(stock(canvas).getByTestId("rack-line-value-74")).toHaveTextContent("Rp 520.000");
    const headers = within(canvas.getByTestId("rack-detail-stock")).getAllByRole("columnheader");
    await expect(headers.map((h) => h.textContent)).toEqual(["Product", "Team", "On this rack", "Unit cost", "Value"]);
    await expect(canvas.getByTestId("rack-summary-count")).toHaveTextContent("25 units");
    await expect(canvas.getByTestId("rack-summary-value")).toHaveTextContent("Rp 812.000");
  },
};

// …and on a phone: the block's last line is *Rp 18.500 × 12 … Rp 222.000*.
export const RootReadsTheValueOnAPhone: Story = {
  name: "Root reads the value, phone",
  globals: { viewport: { value: "mobile1" } },
  beforeEach: asRootFromOutside,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-line-price-71")).toHaveTextContent("Rp 18.500 × 12 … Rp 222.000"));
    await expect(within(canvas.getByTestId("rack-detail-stock")).queryAllByRole("columnheader")).toHaveLength(0);
    await expect(canvas.getByTestId("rack-summary-value")).toHaveTextContent("Rp 812.000");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// AN EMPTY RACK SAYS SO, AND WHAT FILLS IT (an-empty-list-shows-a-hint) — B-02-1 holds nothing and has no history: Produk
// says it, and so does Riwayat.
export const AnEmptyRack: Story = {
  name: "An empty rack",
  render: () => <At43 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const empty = await canvas.findByTestId("rack-detail-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("moved to it from another");
    await expect(canvas.getByTestId("rack-summary-last-counted")).toHaveTextContent("Never counted");
    await expect(await canvas.findByTestId("rack-history-empty")).toBeVisible();
  },
};
