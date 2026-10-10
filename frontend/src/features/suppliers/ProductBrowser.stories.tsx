import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { SupplierChannelRecord } from "./adapt";
import { ProductBrowser } from "./ProductBrowser";
import { sampleProductsFor } from "./sampleProducts";
import { formatUnixDate } from "../../lib/datetime";
import { pickTeam } from "../../../.storybook/pageStory";

// A supplier's Products tab, shared by the manage and discover details. ⚠ SAMPLE rows — two invented products
// per channel (sampleProducts.ts) until the link an accepted restock writes is built
// (restock-accepted-links-the-product-to-its-channel).

const channel = (id: number, channelType: Marketplace, name: string): SupplierChannelRecord => ({
  id: BigInt(id),
  supplierId: 1n,
  channelType,
  name,
  uri: "",
  description: "",
});

const TWO = [channel(1, Marketplace.SHOPEE, "Sumber Makmur Official"), channel(2, Marketplace.TOKOPEDIA, "Sumber Makmur Store")];
const SEVEN = Array.from({ length: 7 }, (_, i) => channel(10 + i, Marketplace.LAZADA, `Store ${i + 1}`));

const meta = {
  title: "Features/Suppliers/ProductBrowser",
  component: ProductBrowser,
  args: { channels: TWO },
} satisfies Meta<typeof ProductBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoChannels: Story = { args: { channels: [] } };

// Each product names the channel it is bought from (products-hang-off-a-channel).
export const ProductsNameTheirChannel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 4);
    await expect(canvas.getByTestId("product-row-1-0")).toHaveTextContent("Sumber Makmur Official");
  },
};

export const SearchesProductSkuOrChannel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("products-search"), "Sumber Makmur Store", { delay: 20 });
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 2));
  },
};

// Seven channels, fourteen products: two pages of ten.
export const Paginates: Story = {
  args: { channels: SEVEN },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 10));
    await userEvent.click(canvas.getByTestId("products-pager-next"));
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 4));
  },
};

// ── A row (`a-supplier-product-row-says-whose-where-and-when`) ──────────────────────────────────────────────

// A ROW SAYS WHOSE, WHERE AND WHEN — the product with its picture and its SKU under its name, the team whose product
// it is, the store it was bought at (its name, its type under it), the last restock and the first under it.
export const ARowSaysWhoseWhereAndWhen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId("product-row-1-0");
    const product = sampleProductsFor(TWO)[0]!;

    await expect(within(row).getByRole("img")).toBeInTheDocument();
    await expect(row).toHaveTextContent("KTN-JP-01");
    await expect(row).toHaveTextContent("Toko Melati");
    await expect(row).toHaveTextContent(formatUnixDate(product.lastBoughtAt));
    await expect(row).toHaveTextContent(`first ${formatUnixDate(product.firstBoughtAt)}`);

    const store = within(row).getByText("Sumber Makmur Official").getBoundingClientRect();
    await expect(within(row).getByTestId(/^marketplace-badge-/).getBoundingClientRect().top).toBeGreaterThanOrEqual(store.bottom);
  },
};

// Bought once, it is one date — no "first" repeating the last.
export const BoughtOnceIsOneDate: Story = {
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByTestId("product-row-2-0");
    await expect(row).not.toHaveTextContent("first");
  },
};

// Two teams buying at one store are two rows, each naming its own team (every-accepted-line-links-its-own-product).
export const EachRowNamesItsTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("product-row-1-0")).toHaveTextContent("Toko Melati");
    await expect(canvas.getByTestId("product-row-1-1")).toHaveTextContent("Toko Kenanga");
  },
};

// Newest restock first (a-link-remembers-its-last-restock) — a store that stopped selling something sinks.
export const NewestFirst: Story = {
  args: { channels: SEVEN },
  play: async ({ canvasElement }) => {
    const rows = within(within(canvasElement).getByTestId("products-table")).getAllByRole("row").slice(1);
    const keys = rows.map((row) => row.getAttribute("data-testid"));
    const expected = sampleProductsFor(SEVEN)
      .slice(0, 10)
      .map((p) => `product-row-${p.key}`);

    await expect(keys).toEqual(expected);
    const dates = sampleProductsFor(SEVEN).map((p) => p.lastBoughtAt);
    await expect(dates.every((d, i) => i === 0 || d <= dates[i - 1]!)).toBe(true);
  },
};

// A product with no picture shows the placeholder, not an empty box.
export const NoPictureIsAPlaceholder: Story = {
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByTestId("product-row-2-1");
    await expect(row).toHaveTextContent("KCG-12");
    await expect(within(row).queryByRole("img")).toBeNull();
  },
};

// On a phone a product is a block: the product with its team beside the SKU, the store, then when.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const block = await within(canvasElement).findByTestId("product-row-1-0");
    await expect(block).toHaveTextContent("Toko Melati");
    // The first restock on its OWN line, under the last — never wrapped onto it (the-first-restock-has-its-own-line).
    const last = within(block).getByTestId("product-row-1-0-last").getBoundingClientRect();
    const first = within(block).getByTestId("product-row-1-0-first").getBoundingClientRect();
    await expect(first.top).toBeGreaterThanOrEqual(last.bottom);
  },
};

// ── The filters, Tim then Toko (`the-products-tab-filters-by-team-and-store`) ──────────────────────────────────────────────

// ONE STORE — a search select over the supplier's own stores: only what was bought there stays.
export const FiltersByStore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("products-store"));
    const option = await canvas.findByTestId("products-store-option-2");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 2));
    await expect(canvas.getByTestId("product-row-2-0")).toBeVisible();
    await expect(canvas.queryByTestId("product-row-1-0")).toBeNull();
  },
};

// ONE TEAM — the Statistik tab's picker. Its products only, and the Team column goes: it would repeat one name.
export const FiltersByTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickTeam(canvas.getByTestId("products-team-filter"), "SL-02");

    await waitFor(() => expect(canvas.queryByTestId("product-row-1-0")).toBeNull());
    await expect(canvas.getByTestId("product-row-1-1")).toHaveTextContent("BNG-PL-40");
    await expect(within(canvas.getByTestId("products-table")).queryByRole("columnheader", { name: "Team" })).toBeNull();
  },
};

// Clear puts every filter back.
export const ClearPutsEveryFilterBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickTeam(canvas.getByTestId("products-team-filter"), "SL-02");
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 1));

    await userEvent.click(canvas.getByTestId("products-filter-clear"));
    await waitFor(() => expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 4));
    await expect(within(canvas.getByTestId("products-table")).getByRole("columnheader", { name: "Team" })).toBeVisible();
  },
};

// Tim, then Toko — the order of the table's columns.
export const TeamComesBeforeStore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const team = canvas.getByTestId("products-team-filter").getBoundingClientRect();
    const store = canvas.getByTestId("products-store-filter").getBoundingClientRect();
    await expect(team.left).toBeLessThan(store.left);
  },
};

// A ROW LIGHTS UP under the pointer, every cell of it (a-supplier-tab-row-lights-up) — driven by `data-hover`.
export const AProductRowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByTestId("product-row-1-0");
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};
