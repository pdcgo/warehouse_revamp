import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { SUPPLIER_DISCOVER_DETAIL_META, loaded } from "./kit";

// DISCOVER SUPPLIER DETAIL — the tabs — Products, Statistics counting every team
// (every-selling-team-sees-every-teams-figures), what is marked, and each tab's Export. The page's stories are
// grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share
// is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSupplierDetail/Tabs",
  ...SUPPLIER_DISCOVER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProductsTab: Story = {
  name: "Products tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-products"));
    await canvas.findByTestId("products-table");
  },
};

// the-figures-are-a-statistics-tab-and-a-supplier-report — the figures supplier_service folds (SupplierStatistics).
export const StatisticsTab: Story = {
  name: "Statistics tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));
    await canvas.findByTestId("statistics-summary");
  },
};

// every-selling-team-sees-every-teams-figures: another team's supplier shows EVERY team's restocks from it — Toko
// Anggrek keeps PT Tekstil Nusantara, and Toko Melati's Beras bought there is on the by-product table, named.
export const StatisticsCountEveryTeam: Story = {
  name: "Statistics, every team",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));

    // The team picker starts EMPTY — the filter left empty is every team (the-team-filter-picks-any-selling-team).
    const picker = within(await canvas.findByTestId("statistics-team")).getByRole("combobox");
    await expect(picker).toHaveValue("");
    await expect(picker).toHaveAttribute("placeholder", "Every team");
    await userEvent.click(canvas.getByTestId("statistics-view-product"));
    const named = await canvas.findAllByTestId("statistics-product-team");
    await expect(named.map((cell) => cell.textContent)).toContain("Toko Melati");
  },
};

// The Products tab and the stores' and products' figures are marked — the supplier itself is a real read now.
export const TheProductsAndTheFiguresAreSample: Story = {
  name: "Sample marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(
      within(canvas.getByTestId("supplier-tab-products")).getByTestId("not-implemented-products"),
    ).toBeVisible();
    await expect(canvas.queryByTestId("not-implemented-supplier")).toBeNull();
  },
};

// EACH TAB EXPORTS ITS OWN TABLE, as on the manage detail (each-supplier-tab-exports-its-own-table) — read-only, so the
// Export is the strip's only action; marked 7 in THIS page's list.
export const EachTabExportsItsOwnTable: Story = {
  name: "Export marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const button = await canvas.findByTestId("channels-export");
    await expect(within(button).getByTestId("not-implemented-export")).toHaveTextContent("7");
  },
};
