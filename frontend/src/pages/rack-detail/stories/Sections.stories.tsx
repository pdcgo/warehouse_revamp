import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { RACK_DETAIL_META, loaded, stock } from "./kit";

// RACK DETAIL — the page's shape: one page of sections under a nav (a-rack-page-is-one-page-of-sections), the product
// page's and the restock pages' — no tabs. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/Sections",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THREE SECTIONS ON ONE PAGE, IN THE NAV'S ORDER — what is on the shelf first, then the rack's record, then what has
// happened to it; none behind a tab, and no pair reading twice: Produk carries the price and the value (for a reader the
// server gives them to — Shelf / Root reads the value; this staff member reads units only), Riwayat the Penempatan chip.
// Produk is lit as the page opens.
export const OnePageOfSections: Story = {
  name: "One page of sections",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const nav = canvas.getByTestId("section-nav");

    await expect([...nav.querySelectorAll<HTMLElement>("[data-section]")].map((el) => el.dataset.section)).toEqual([
      "products",
      "info",
      "history",
    ]);
    await expect(canvas.getByTestId("section-nav-products")).toHaveAttribute("aria-current", "location");
    for (const panel of ["products", "info", "history"]) {
      await expect(canvas.getByTestId(`rack-${panel}-panel`)).toBeInTheDocument();
    }
    await expect(canvas.queryByRole("tablist")).toBeNull();

    // Produk is the shelf; the Harga tab's two columns are its own, but not a warehouse's
    // (a-warehouse-sees-ready-value-but-a-shelf-only-units) — staff read the units alone.
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("12"));
    await expect(stock(canvas).queryByTestId("rack-unit-cost-71")).toBeNull();
    await expect(stock(canvas).queryByTestId("rack-line-value-71")).toBeNull();
    await expect(canvas.getByTestId("rack-info-code")).toHaveTextContent("A-01-1");
    // Info's three labels are words, never a raw i18n key (`racks.detail.description` was missing from both catalogues).
    const info = canvas.getByTestId("rack-info-panel");
    await expect(info).toHaveTextContent("Code");
    await expect(info).toHaveTextContent("Name");
    await expect(info).toHaveTextContent("Description");
    await expect(info).not.toHaveTextContent("racks.detail");
    await expect(canvas.getByTestId("rack-history-filter-all")).toHaveAttribute("aria-pressed", "true");
  },
};

// A NAV CLICK JUMPS THERE AND LIGHTS IT (a-nav-jump-blinks-where-it-lands) — Riwayat, the last section.
export const TheNavJumps: Story = {
  name: "Nav jumps",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("section-nav-history"));
    await waitFor(() => expect(canvas.getByTestId("section-nav-history")).toHaveAttribute("aria-current", "location"));
    await waitFor(() => expect(canvas.getByTestId("rack-history-panel").getBoundingClientRect().top).toBeLessThan(window.innerHeight));
  },
};
