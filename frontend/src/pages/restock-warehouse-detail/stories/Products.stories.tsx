import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { At503, At507, WAREHOUSE_DETAIL_META, loaded } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the lines as counted — missing, broken with its photo, where the good units went.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Products",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE BROKEN UNITS' PHOTO (a-broken-product-carries-a-photo) — 503's rice: a thumbnail beside the broken count that opens
// the photo whole. A SAMPLE, the page's second mark; the tea, nothing broken, has none.
export const TheBrokenCountShowsItsPhoto: Story = {
  name: "Broken photo",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const cell = canvas.getByTestId("restock-detail-broken-74");
    await expect(within(cell).getByTestId("not-implemented-brokenPhoto")).toHaveTextContent("2");
    await expect(canvas.queryByTestId("restock-detail-broken-photo-72")).toBeNull();

    await userEvent.click(within(cell).getByTestId("restock-detail-broken-photo-74-open"));
    const whole = await screen.findByTestId("restock-detail-broken-photo-74-dialog");
    await waitFor(() => expect(whole).toBeVisible());
    await expect(within(whole).getByRole("img")).toBeVisible();
  },
};

// The lines as counted: Missing, never Lost (a-short-unit-at-the-door-is-missing), and WHERE the good units went, by
// placement code (there-is-no-unplaced-pile).
export const TheCountAndThePlacements: Story = {
  name: "Count and placements",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = canvas.getByTestId("restock-detail-items");
    await expect(canvas.getByTestId("restock-detail-col-missing")).toHaveTextContent("Missing");
    await expect(within(table).queryByRole("columnheader", { name: /^Lost/ })).toBeNull();
    await expect(canvas.getByTestId("restock-detail-missing-74-count")).toHaveTextContent("1");
    await expect(canvas.getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");

    await waitFor(() => expect(canvas.getByTestId("restock-detail-placement-74")).toHaveTextContent("A-01-1 (5), B-02-1 (2)"));
    await expect(canvas.getByTestId("restock-detail-placement-72")).toHaveTextContent("A-01-2 (20)");
  },
};

// a-deleted-supplier-still-shows-with-a-badge — on the warehouse's copy too.
export const ADeletedStoreKeepsItsName: Story = {
  name: "Deleted store named",
  render: () => <At507 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const supplier = canvas.getByTestId("restock-detail-supplier-72");
    await waitFor(() => expect(within(supplier).getByTestId("deleted-badge")).toBeVisible());
  },
};
