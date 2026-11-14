import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { SELLING_META, loaded, sellingAt } from "./kit";

// TRANSFER SELLING — the status tabs, the filters in the URL, the empty hint and the growing pager, on a DESKTOP. The
// page's stories are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen);
// what they share is ./kit.tsx. The phone's are in ./Phone.stories.tsx.

const meta = {
  title: "Pages/Inventory/WarehouseTransfer/TransferSelling/Filters",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The status tab is a server-side filter.
export const ShippedTab: Story = {
  name: "The shipped tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-tab-shipped"));
    await waitFor(() => expect(canvas.queryByTestId("transfer-row-601")).toBeNull());
    await expect(canvas.getByTestId("transfer-row-603")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-row-608")).toBeInTheDocument();
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the tab and the search are its; a
// change is written back.
const AtFilteredUrl = sellingAt("/inventories/transfer?status=shipped&q=JNE");

export const FiltersLiveInTheUrl: Story = {
  name: "Filters live in the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("transfer-row-603", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId("transfer-search")).toHaveValue("JNE");
    await expect(canvas.getByTestId("transfer-tab-shipped")).toHaveAttribute("aria-selected", "true");
    // 608 is shipped too, by another courier — the search is what leaves it out.
    await expect(canvas.queryByTestId("transfer-row-608")).toBeNull();

    await userEvent.click(canvas.getByTestId("transfer-tab-arrived"));
    await waitFor(() => expect(location).toHaveTextContent("status=arrived"));
    await expect(location).toHaveTextContent("q=JNE");
  },
};

// NOTHING MATCHES, ON ALL TOO (an-empty-list-shows-a-hint): a search that finds nothing says so — never "No transfers
// yet", which would read as an empty team — and its Clear Filters is the strip's Clear: the search goes, from the URL too,
// and the rows return. Where the rows would be, no table header over nothing.
const AtNoMatch = sellingAt("/inventories/transfer?q=zzz");

export const NothingMatches: Story = {
  name: "Empty: nothing matches",
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(canvas.getByTestId("transfer-tab-all")).toHaveAttribute("aria-selected", "true");
    await expect(empty).toHaveTextContent("No transfers match.");
    await expect(empty).not.toHaveTextContent("No transfers yet");
    await expect(canvas.queryByTestId("transfers-table")).toBeNull();
    await expect(canvas.getByTestId("transfer-pager")).toBeVisible();

    await userEvent.click(canvas.getByTestId("transfers-empty-clear"));
    await canvas.findByTestId("transfer-row-601", {}, { timeout: 4000 });
    // The URL write is gathered and committed a moment after the rows can already be back.
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("q="));
  },
};

// NOTHING YET: Toko Anggrek has opened no transfer — the hint says what one is for, and offers New Transfer.
export const NothingYet: Story = {
  name: "Empty: nothing yet",
  beforeEach: () => {
    asTeam(15n)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No transfers yet.");
    await expect(empty).toHaveTextContent("Open a transfer to move stock from one warehouse to another.");
    await userEvent.click(canvas.getByTestId("open-create-transfer-empty"));
    await canvas.findByTestId("at-transfer-new");
  },
};

// AN EMPTY TAB says which status has none — and offers no New Transfer, which belongs to the whole list's hint.
const AtShippedTab = sellingAt("/inventories/transfer?status=shipped");

export const AnEmptyTab: Story = {
  name: "Empty: a status with none",
  beforeEach: () => {
    asTeam(15n)();
  },
  render: () => <AtShippedTab />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No shipped transfers.");
    await expect(canvas.queryByTestId("open-create-transfer-empty")).toBeNull();
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
