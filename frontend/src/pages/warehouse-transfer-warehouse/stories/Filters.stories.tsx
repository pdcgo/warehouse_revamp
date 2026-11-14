import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { WAREHOUSE_META, loaded, warehouseAt } from "./kit";

// TRANSFER WAREHOUSE — the direction, the status tabs, the filters in the URL, the empty hint and the growing pager, on a
// DESKTOP. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx. The phone's are in ./Phone.stories.tsx.

const meta = {
  title: "Pages/Inventory/WarehouseTransfer/TransferWarehouse/Filters",
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the direction and the tab are its; a
// change is written back.
const AtFilteredUrl = warehouseAt("/inventories/transfer?direction=incoming&status=shipped");

export const FiltersLiveInTheUrl: Story = {
  name: "Filters live in the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("transfer-row-608", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId("transfer-direction-incoming")).toHaveAttribute("data-state", "checked");
    await expect(canvas.getByTestId("transfer-tab-shipped")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.queryByTestId("transfer-row-601")).toBeNull();

    await userEvent.type(canvas.getByTestId("transfer-search"), "SCP", { delay: 40 });
    await waitFor(() => expect(location).toHaveTextContent("q=SCP"));
    await expect(location).toHaveTextContent("direction=incoming");
    await expect(canvas.getByTestId("transfer-row-608")).toBeInTheDocument();
  },
};

// NOTHING MATCHES, ON ALL TOO (an-empty-list-shows-a-hint): a search that finds nothing says so — never "Nothing is
// leaving this warehouse", which would read as an idle building — and its Clear Filters is the strip's Clear.
const AtNoMatch = warehouseAt("/inventories/transfer?q=zzz");

export const NothingMatches: Story = {
  name: "Empty: nothing matches",
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(canvas.getByTestId("transfer-tab-all")).toHaveAttribute("aria-selected", "true");
    await expect(empty).toHaveTextContent("No transfers match.");
    await expect(empty).not.toHaveTextContent("Nothing is leaving this warehouse");
    await expect(canvas.queryByTestId("transfers-table")).toBeNull();
    await expect(canvas.getByTestId("transfer-pager")).toBeVisible();

    await userEvent.click(canvas.getByTestId("transfers-empty-clear"));
    await canvas.findByTestId("transfer-row-601", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("q="));
  },
};

// AN EMPTY TAB says which status has none; no Clear Filters — nothing is filtered.
const AtEmptyTab = warehouseAt("/inventories/transfer?direction=incoming&status=cancelled");

export const AnEmptyTab: Story = {
  name: "Empty: a status with none",
  render: () => <AtEmptyTab />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No cancelled transfers.");
    await expect(canvas.queryByTestId("transfers-empty-clear")).toBeNull();
  },
};

// THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager): ‹ [1] › with both arrows off on one page,
// the per-page size kept, and the old Pagination gone.
export const ThePagerGrows: Story = {
  name: "The growing pager",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("transfer-pager")).toBeVisible();
    await expect(canvas.getByTestId("transfer-pager-page-1")).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByTestId("transfer-pager-next")).toBeDisabled();
    await expect(canvas.getByTestId("transfer-pager-size")).toBeVisible();
    await expect(canvas.queryByTestId("pagination-bar")).toBeNull();
  },
};
