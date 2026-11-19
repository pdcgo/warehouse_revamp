import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { DESKTOP, PHONE, TAG, TAG_VIEWPORTS } from "../../../../.storybook/restockTagKit";
import { RestockWarehousePage } from "../index";
import { WAREHOUSE_META, loaded } from "./kit";

// RESTOCK WAREHOUSE — THE TAGS (backlog #87, live since the-restock-tags-prototype-is-accepted). A restock's tags are the
// restock's, seen and filtered on the warehouse's list as on the seller's (custom-tags-are-shared-system-tags-are-the-
// admins-and-the-apps): a Tags column after the status (a line of chips in a phone's block) and a Tag filter after the
// team it comes from — this list has no courier filter. SEVERAL tags, a restock in when it carries ANY. Like the person
// and the dates, the tags narrow the ROWS; the headline keeps following the From lens alone.
//
// Gudang Pusat's queue opens on the last 7 days: 501 (Audit Gudang, Prioritas, Lebaran 2026), 502 (Prioritas) and Toko
// Kenanga's 506 (Barang Promo). Over all dates, 503 carries the app's Barang kurang + Barang rusak.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouse/Tags",
  ...WAREHOUSE_META,
  parameters: { ...WAREHOUSE_META.parameters, viewport: { options: TAG_VIEWPORTS } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const rowIds = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll("[data-testid^='restock-row-']")].map((el) => el.getAttribute("data-testid")).sort();

/** CHIPS ON THE INBOUND ROWS — both selling teams' tags, read the same: Toko Kenanga's *Barang Promo* on 506. */
export const ChipsOnTheInboundRows: Story = {
  name: "Chips on the inbound rows",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(within(canvas.getByTestId("restock-inbound-table")).getByRole("columnheader", { name: "Tags" })).toBeVisible();
    await expect(canvas.getByTestId(`restock-tags-506-${TAG.promo}`)).toHaveTextContent("Barang Promo");
    await expect(canvas.getByTestId(`restock-tags-501-${TAG.lebaran}`)).toHaveTextContent("Lebaran 2026");

    // After the From filter.
    const strip = [...canvasElement.querySelectorAll("[data-testid^='restock-inbound-from'], [data-testid='restock-tag-filter']")].map(
      (el) => el.getAttribute("data-testid"),
    );
    await expect(strip).toEqual(["restock-inbound-from", "restock-tag-filter"]);
  },
};

/**
 * THE PROBLEM LIST AT THE WAREHOUSE — over all dates, *Barang rusak* leaves 503 alone, with its missing and broken counts;
 * *Barang Promo* picked too reads ANY of them — 506 joins. The picks are in the address.
 */
const AllDates = routedPage(
  [{ path: "/inventories/restock", element: <><RestockWarehousePage /><LocationProbe hidden /></> }],
  "/inventories/restock?range=all",
);

export const TheProblemListAtTheWarehouse: Story = {
  name: "Filter by tags — any of them",
  globals: DESKTOP,
  render: () => <AllDates />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(within(canvas.getByTestId("restock-tag-filter")).getByRole("combobox"));
    const option = await screen.findByTestId(`restock-tag-filter-option-${TAG.broken}`, {}, { timeout: 3000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.queryByTestId("restock-row-501")).toBeNull());
    await expect(rowIds(canvasElement)).toEqual(["restock-row-503"]);
    await expect(canvas.getByTestId("restock-missing-503")).toHaveTextContent("1 missing");
    await expect(canvas.getByTestId("restock-broken-503")).toHaveTextContent("2 broken");
    await expect(canvas.getByTestId(`restock-tags-503-${TAG.broken}-lock`)).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`tag=${TAG.broken}`));

    await userEvent.click(screen.getByTestId(`restock-tag-filter-option-${TAG.promo}`));
    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["restock-row-503", "restock-row-506"]));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`tag=${TAG.broken}%2C${TAG.promo}`));
  },
};

/** ON A PHONE — the chips are a line of the block, under the team it came from. */
export const OnAPhone: Story = {
  name: "Phone — a line of chips in each block",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(390);
    const block = within(canvas.getByTestId("restock-row-501"));
    await expect(block.getByTestId(`restock-tags-501-${TAG.prioritas}`)).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
