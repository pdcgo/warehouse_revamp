import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIER_DISCOVER_DETAIL_META, loaded } from "./kit";

// DISCOVER SUPPLIER DETAIL — the Stores tab — read-only, its Sold and Ready (the-detail-tabs-show-sold-and-ready),
// the search and the type filter. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSupplierDetail/Stores",
  ...SUPPLIER_DISCOVER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Read-only: another team's supplier offers no Add Channel and no row actions.
export const ReadOnly: Story = {
  name: "Read-only",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await canvas.findByTestId("channels-table");
    await expect(canvas.queryByTestId("add-channel")).toBeNull();
    await expect(canvas.queryAllByTestId(/^edit-channel-|^delete-channel-/)).toHaveLength(0);
  },
};

// A STORE SHOWS ITS SOLD AND READY, as on the manage detail (the-detail-tabs-show-sold-and-ready) — read-only, so the
// two columns are the table's last; marked 2 and 3 in THIS page's list.
export const AStoreShowsItsSoldAndReady: Story = {
  name: "Sold and Ready",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = await canvas.findByTestId("channels-table");
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
    const headers = within(table).getAllByRole("columnheader");
    await expect(headers.at(-2)).toHaveTextContent(/^Sold/);
    await expect(headers.at(-1)).toHaveTextContent(/^Ready/);
    await expect(within(headers.at(-2)!).getByTestId("not-implemented-sold")).toHaveTextContent("2");
    await expect(within(headers.at(-1)!).getByTestId("not-implemented-ready")).toHaveTextContent("3");
  },
};

// The same Channels browser as the manage detail — searched and filtered by type, on the server.
export const ChannelsSearchAndFilter: Story = {
  name: "Search and type",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = await canvas.findByTestId("channels-table");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(1 + 3));

    await userEvent.click(within(canvas.getByTestId("channels-type-filter")).getByTestId("marketplace-select"));
    const blibli = await canvas.findByRole("option", { name: "Blibli" });
    await waitFor(() => expect(blibli).toBeVisible());
    await userEvent.click(blibli);
    await waitFor(() => expect(within(canvas.getByTestId("channels-table")).getAllByRole("row")).toHaveLength(1 + 1));
    await expect(canvas.getByTestId("channels-table")).toHaveTextContent("Nusantara Official");
  },
};
