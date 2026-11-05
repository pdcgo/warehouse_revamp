import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { RestockSellingPage } from "../index";
import { SELLING_META, loaded } from "./kit";

// RESTOCK SELLING — the tabs, the search and the filters — in the URL, the empty hint, and the parts marked. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Filters",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Five statuses, five tabs, plus All (statusTabs.ts).
export const FiveStatusTabs: Story = {
  name: "Status tabs",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const tab of ["all", "ongoing", "arrived", "accepted", "lost", "cancelled"]) {
      await expect(canvas.getByTestId(`restock-tab-${tab}`)).toBeVisible();
    }
  },
};

// The Arrived tab is a real filter — the box at the door, waiting for the warehouse to count it.
export const TheArrivedTab: Story = {
  name: "Arrived tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-tab-arrived"));
    await waitFor(() => expect(canvas.queryByTestId("restock-row-501")).toBeNull());
    await expect(canvas.getByTestId("restock-row-502")).toBeVisible();
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the tab and the search are its; a
// change is written back.
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe /></> }],
  "/inventories/restock?status=arrived&q=JNT",
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-502", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId("restock-search")).toHaveValue("JNT");
    await expect(canvas.getByTestId("restock-tab-arrived")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.queryByTestId("restock-row-501")).toBeNull();

    await userEvent.click(canvas.getByTestId("restock-tab-accepted"));
    await waitFor(() => expect(location).toHaveTextContent("status=accepted"));
    await expect(location).toHaveTextContent("q=JNT");
  },
};

// NOTHING MATCHES — the empty hint says so and clears the filters (an-empty-list-shows-a-hint); so does the strip's red
// Hapus Filter (clear-filters-is-red-and-bold). The status tab is not a filter, and stays.
const AtNoMatch = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe /></> }],
  "/inventories/restock?status=ongoing&q=nothing-is-called-this",
);

export const NothingMatchesClearsTheFilters: Story = {
  name: "Nothing matches",
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("restock-requests-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No restocks match.");
    await expect(canvas.getByTestId("restock-filter-clear")).toBeVisible();
    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));

    await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("restock-search")).toHaveValue("");
    await expect(canvas.getByTestId("restock-tab-ongoing")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.queryByTestId("restock-filter-clear")).toBeNull();
  },
};

// EXPORT AND THE COURIER FILTER ARE ON SCREEN, MARKED (the-restock-list-exports-and-filters-by-courier) — Export beside New
// Restock, its ⚠ on it, and its click says it is not there yet; the courier picked is kept in the URL and counted, so
// Clear takes it back, while the rows do not move for it.
const AtList = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe /></> }],
  "/inventories/restock",
);

export const ExportAndTheCourierFilterAreMarked: Story = {
  name: "Export and courier, marked",
  render: () => <AtList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    const exporter = canvas.getByTestId("restock-export");
    await expect(within(exporter).getByTestId("not-implemented-export")).toHaveTextContent("1");
    await userEvent.click(exporter);
    // The toast slides in — wait for it to land before reading it.
    const toast = await screen.findByText("Exporting restocks is not available yet.");
    await waitFor(() => expect(toast).toBeVisible());

    const courier = canvas.getByTestId("restock-courier-filter");
    await expect(within(courier).getByTestId("not-implemented-courier")).toHaveTextContent("2");
    await userEvent.click(within(courier).getByRole("combobox"));
    await userEvent.click(await screen.findByTestId("shipment-channel-option-jne"));
    await waitFor(() => expect(location).toHaveTextContent("courier=91"));
    await expect(canvas.getByTestId("restock-filter-clear")).toBeVisible();
    // Held, not asked: the J&T restock is still on the list.
    await expect(canvas.getByTestId("restock-row-502")).toBeVisible();

    await userEvent.click(canvas.getByTestId("restock-filter-clear"));
    await waitFor(() => expect(location).not.toHaveTextContent("courier="));
  },
};
