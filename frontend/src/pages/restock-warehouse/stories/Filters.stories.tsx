import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { userClient } from "../../../api/clients";
import { RestockWarehousePage } from "../index";
import { WAREHOUSE_META, loaded } from "./kit";

// RESTOCK WAREHOUSE — the status tabs, the filters kept in the URL, and the empty hint that clears them.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouse/Filters",
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// NOTHING MATCHES — the empty hint says so and clears the filters (an-empty-list-shows-a-hint); so does the strip's red
// Hapus Filter (clear-filters-is-red-and-bold). The status tab is not a filter, and stays.
const AtNoMatch = routedPage(
  [{ path: "/inventories/restock", element: <><RestockWarehousePage /><LocationProbe /></> }],
  "/inventories/restock?status=ongoing&q=nothing-is-called-this",
);

export const NothingMatchesClearsTheFilters: Story = {
  name: "Nothing matches",
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("restock-inbound-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No restocks match.");
    await expect(canvas.getByTestId("restock-inbound-filter-clear")).toBeVisible();
    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));

    await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("restock-inbound-search")).toHaveValue("");
    await expect(canvas.getByTestId("restock-tab-ongoing")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.queryByTestId("restock-inbound-filter-clear")).toBeNull();
  },
};

export const FiveStatusTabs: Story = {
  name: "Status tabs",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const tab of ["all", "ongoing", "arrived", "accepted", "lost", "cancelled"]) {
      await expect(canvas.getByTestId(`restock-tab-${tab}`)).toBeVisible();
    }
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the tab and the person's role are
// its; a change is written back. The 7-day window is the default, so it is not in the URL at all.
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/restock", element: <><RestockWarehousePage /><LocationProbe /></> }],
  "/inventories/restock?status=arrived&role=accepted",
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-502", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId("restock-tab-arrived")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByTestId("restock-inbound-actor-role")).toHaveTextContent("Counted by");
    await expect(canvas.queryByTestId("restock-row-501")).toBeNull();

    await userEvent.click(canvas.getByTestId("restock-tab-ongoing"));
    await waitFor(() => expect(location).toHaveTextContent("status=ongoing"));
    await expect(location).toHaveTextContent("role=accepted");
    await expect(location).not.toHaveTextContent("range=");
  },
};

// THE PAGE'S PEOPLE ARE NAMED ONCE (#133, the-speed-audits-old-findings-are-fixed-smallest-first) — the rows' (who raised,
// signed for, accepted each) and the person filter's people come from ONE UserByIDs of both id sets; a read each was
// UserByIDs twice a load.
export const ThePeopleAreNamedOnce: Story = {
  name: "People named once",
  beforeEach: () => {
    const spy = spyOn(userClient, "userByIDs");

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("restock-created-by-501")).toHaveTextContent(/^by /));

    // On a phone the person filter is in the sheet.
    const open = canvas.queryByTestId("restock-inbound-filter-open");
    let controls = canvas;
    if (open) {
      await userEvent.click(open);
      const sheet = await screen.findByTestId("restock-inbound-filter-sheet");
      await waitFor(() => expect(sheet).toBeVisible());
      controls = within(sheet);
    }

    const input = within(controls.getByTestId("restock-inbound-person")).getByRole("combobox");
    await userEvent.click(input);
    await waitFor(
      () => {
        const listbox = document.getElementById(input.getAttribute("aria-controls") ?? "");
        expect(listbox).not.toBeNull();
        expect(within(listbox!).getAllByTestId(/^person-filter-option-/)[0]).toBeVisible();
      },
      { timeout: 5000 },
    );
    // Named, every one — "#66" would be an id the one read never asked for.
    const listbox = document.getElementById(input.getAttribute("aria-controls") ?? "")!;
    for (const option of within(listbox).getAllByTestId(/^person-filter-option-/)) {
      await expect(option).not.toHaveTextContent(/^#\d/);
    }

    await expect(
      (userClient.userByIDs as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(1);
  },
};
