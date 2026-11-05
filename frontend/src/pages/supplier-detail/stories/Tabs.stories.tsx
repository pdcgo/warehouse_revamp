import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIER_DETAIL_META, SHOPEE_STORE, loaded, openProducts } from "./kit";

// SUPPLIER DETAIL — the three tabs and their one underline, what is not real yet, and each tab's Export
// (each-supplier-tab-exports-its-own-table). The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierDetail/Tabs",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProductsTab: Story = {
  name: "Products tab",
  play: async ({ canvasElement }) => {
    await openProducts(await loaded(canvasElement));
  },
};

// the-figures-are-a-statistics-tab-and-a-supplier-report — the figures supplier_service folds (SupplierStatistics).
export const StatisticsTab: Story = {
  name: "Statistics tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));
    await expect(await canvas.findByTestId("supplier-statistics")).toBeInTheDocument();
  },
};

// supplier-detail-has-channels-and-products-tabs: HORIZONTAL tabs, Channels open on arrival — and Statistics beside
// them (the-figures-are-a-statistics-tab-and-a-supplier-report).
export const ChannelsAndProductsTabs: Story = {
  name: "Three tabs, Stores open",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const tablist = canvas.getByRole("tablist");
    await expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
    await expect(within(tablist).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Stores",
      // Products carries its own sample mark; Statistics is real (the-figures-screens-are-accepted).
      "Products1",
      "Statistics",
    ]);
    await expect(canvas.getByTestId("supplier-tab-channels")).toHaveAttribute("aria-selected", "true");
  },
};

// ONE UNDERLINE, AND IT TRAVELS (motion-is-small-quick-and-shared) — the tab row carries the sliding indicator, and the
// picked tab draws no underline of its own under it; two would read as a double line wherever they overlap. Its slide
// is reviewed by eye: the test browser asks for reduced motion.
export const OneUnderlineThatSlides: Story = {
  name: "One sliding underline",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const tablist = canvas.getByRole("tablist");
    const indicator = tablist.querySelector("[data-part=indicator]");
    await expect(indicator).not.toBeNull();
    await expect(getComputedStyle(indicator!, "::after").height).toBe("2px");

    const picked = canvas.getByTestId("supplier-tab-channels");
    await expect(getComputedStyle(picked, "::before").height).toBe("0px");

    // It follows the pick — over the tab, not merely somewhere in the row.
    await openProducts(canvas);
    const products = canvas.getByTestId("supplier-tab-products").getBoundingClientRect();
    await waitFor(() => expect(Math.round(indicator!.getBoundingClientRect().left)).toBe(Math.round(products.left)));
  },
};

// The one thing that is not real yet, said on the page: the Products tab is invented rows (sample). A channel's
// description is real now, so it carries no mark — not in the table, not in the form.
export const WhatIsNotRealYetIsMarked: Story = {
  name: "Sample marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);
    await expect(
      within(canvas.getByTestId("supplier-tab-products")).getByTestId("not-implemented-products"),
    ).toBeVisible();
    await expect(canvas.queryAllByTestId("not-implemented-channelDescription")).toHaveLength(0);

    await userEvent.click(canvas.getByTestId("add-channel"));
    const description = await screen.findByTestId("channel-description");
    await waitFor(() => expect(description).toBeVisible());
    await expect(
      within(screen.getByRole("dialog")).queryByTestId("not-implemented-channelDescription"),
    ).toBeNull();
  },
};

// EACH TAB EXPORTS ITS OWN TABLE — a grey Export at the right end of the tab's filter strip, left of the tab's primary
// action (Tambah Toko), carrying THIS page's mark (7): nothing builds a file yet.
export const EachTabExportsItsOwnTable: Story = {
  name: "Export per tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    const channels = canvas.getByTestId("channels-export");
    await expect(channels).toHaveTextContent(/^Export/);
    await expect(within(channels).getByTestId("not-implemented-export")).toHaveTextContent("7");
    await expect(channels.getBoundingClientRect().right).toBeLessThanOrEqual(
      canvas.getByTestId("add-channel").getBoundingClientRect().left,
    );
    await expect(channels.getBoundingClientRect().left).toBeGreaterThan(
      canvas.getByTestId("channels-search").getBoundingClientRect().right,
    );

    await openProducts(canvas);
    await expect(await canvas.findByTestId("products-export")).toHaveTextContent(/^Export/);

    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));
    await expect(await canvas.findByTestId("statistics-export", {}, { timeout: 3000 })).toHaveTextContent(/^Export/);
  },
};

// …and on a phone it is in the Filter sheet, full width and labelled — beside the search, Filter and Tambah Toko it
// squeezed the search to a few letters.
export const APhoneExportIsInTheSheet: Story = {
  name: "Phone · Export in the sheet",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    await expect(canvas.queryByTestId("channels-export")).toBeNull();
    await userEvent.click(canvas.getByTestId("channels-filter-open"));
    const sheet = await screen.findByTestId("channels-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    const button = within(sheet).getByTestId("channels-export");
    await expect(button).toHaveTextContent(/^Export/);
    await expect(within(button).getByTestId("not-implemented-export")).toHaveTextContent("7");
  },
};
