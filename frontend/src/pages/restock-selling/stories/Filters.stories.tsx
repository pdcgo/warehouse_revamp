import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { holdRestockExport, restockExportScenario } from "../../../../.storybook/restockExportScenario";
import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import { toaster } from "../../../components/feedback/Toaster";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
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

// EXPORT IS THE LIST AS A FILE (the-restock-list-exports-and-filters-by-courier, one-export-is-the-list-as-a-file) —
// beside New Restock, no ⚠ on it any more. It sends what the rows on screen were asked with: here the Accepted tab and
// JNE, so the file holds 507 alone — the one row the list shows — and the toast says the file is downloading.
const AtList = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe /></> }],
  "/inventories/restock",
);

const READY = "Export ready — the file is downloading";

/** Clears the toasts an earlier story left up — one would read as this click's. */
async function noToasts() {
  toaster.remove();
  await waitFor(() => expect(screen.queryByText(READY)).toBeNull());
}

export const ExportSendsTheListAsAFile: Story = {
  name: "Export, the list as a file",
  render: () => <AtList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const exporter = canvas.getByTestId("restock-export");
    await expect(within(exporter).queryByTestId("not-implemented-export")).toBeNull();

    await userEvent.click(canvas.getByTestId("restock-tab-accepted"));
    await userEvent.click(within(canvas.getByTestId("restock-courier-filter")).getByRole("combobox"));
    await userEvent.click(await screen.findByTestId("shipment-channel-option-jne"));
    await waitFor(() => expect(canvas.queryByTestId("restock-row-503")).toBeNull());
    await expect(canvas.getByTestId("restock-row-507")).toBeVisible();

    await noToasts();
    await userEvent.click(exporter);
    // The toast slides in — wait for it to land before reading it.
    const toast = await screen.findByText(READY);
    await waitFor(() => expect(toast).toBeVisible());

    await expect(restockExportScenario.calls).toHaveLength(1);
    const [call] = restockExportScenario.calls;
    await expect(call!.teamId).toBe(12n);
    await expect(call!.filter?.status).toBe(RestockRequestStatus.ACCEPTED);
    await expect(call!.filter?.shipmentId).toBe(91n);
    await expect(call!.rows).toBe(1);
  },
};

// …ITS PROGRESS ON THE BUTTON (one-export-is-the-list-as-a-file: a stream of progress ending in a link) — while the file
// is made the button counts the restocks written of the list's total and takes no second click; when it arrives the
// button is itself again and the toast says the file is downloading. The stream is held after its count until the play
// releases it (released on cleanup too, so a red run never leaves it waiting).
let releaseExport = () => {};

export const ExportShowsItsProgress: Story = {
  name: "Export, progress on the button",
  render: () => <AtList />,
  beforeEach: () => {
    releaseExport = holdRestockExport();
    return () => releaseExport();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const exporter = canvas.getByTestId("restock-export");

    await noToasts();
    await userEvent.click(exporter);

    // Every restock this team raised — the All tab, no filter.
    await waitFor(() => expect(exporter).toHaveTextContent("Exporting 0 / 6"));
    await expect(exporter).toBeDisabled();

    releaseExport();
    const toast = await screen.findByText(READY);
    await waitFor(() => expect(toast).toBeVisible());
    await waitFor(() => expect(exporter).toHaveTextContent(/^Export$/));
    await expect(exporter).toBeEnabled();
    await expect(restockExportScenario.calls.map((c) => c.rows)).toEqual([6]);
  },
};

// …AND A PHONE ASKS THE SAME — Export is its icon beside New Restock's (a-phone-header-action-is-an-icon).
export const OnAPhoneExportIsItsIcon: Story = {
  name: "Phone · Export",
  globals: { viewport: { value: "mobile1" } },
  render: () => <AtList />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const exporter = await canvas.findByTestId("restock-export", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("open-create-restock")).toBeVisible();

    await noToasts();
    await userEvent.click(exporter);
    const toast = await screen.findByText(READY);
    await waitFor(() => expect(toast).toBeVisible());
    await expect(restockExportScenario.calls.map((c) => c.teamId)).toEqual([12n]);
  },
};

// MONITORING HAS NO EXPORT (monitoring-keeps-what-only-reads) — the admin team reading this team sees the rows, and
// neither header action: New Restock writes a restock, and Export STORES A FILE — its RPC is not marked a read, so the
// server refuses the monitor (the-admin-team-monitors-read-only). Until the export was real the monitor saw its button.
export const MonitoringHasNoExport: Story = {
  name: "Monitoring, no Export",
  beforeEach: () => asAdminTeam()(),
  render: () => <AtList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-row-503")).toBeVisible();
    await expect(canvas.queryByTestId("restock-export")).toBeNull();
    await expect(canvas.queryByTestId("open-create-restock")).toBeNull();
  },
};

// …ON A PHONE TOO — no icons at all in the header.
export const OnAPhoneMonitoringHasNoExport: Story = {
  name: "Phone · monitoring, no Export",
  globals: { viewport: { value: "mobile1" } },
  beforeEach: () => asAdminTeam()(),
  render: () => <AtList />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-requests-table", {}, { timeout: 4000 });

    await expect(canvas.queryByTestId("restock-export")).toBeNull();
    await expect(canvas.queryByTestId("open-create-restock")).toBeNull();
  },
};

// THE COURIER NARROWS THE ROWS (the-restock-list-exports-and-filters-by-courier) — no mark on it any more: JNE keeps
// JNE's restocks (501, 504, 507) and drops J&T's 502, SiCepat's 503 and 505, which names no courier and is listed only
// under any. The pick is in the URL and counted, so Clear takes it back and every row returns.
export const TheCourierNarrowsTheRows: Story = {
  name: "Courier narrows the rows",
  render: () => <AtList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    const courier = canvas.getByTestId("restock-courier-filter");
    await expect(within(courier).queryByTestId("not-implemented-courier")).toBeNull();
    for (const id of [502, 503, 505]) await expect(canvas.getByTestId(`restock-row-${id}`)).toBeVisible();

    await userEvent.click(within(courier).getByRole("combobox"));
    await userEvent.click(await screen.findByTestId("shipment-channel-option-jne"));
    await waitFor(() => expect(location).toHaveTextContent("courier=91"));
    await expect(canvas.getByTestId("restock-filter-clear")).toBeVisible();

    await waitFor(() => expect(canvas.queryByTestId("restock-row-502")).toBeNull());
    for (const id of [503, 505]) await expect(canvas.queryByTestId(`restock-row-${id}`)).toBeNull();
    for (const id of [501, 504, 507]) await expect(canvas.getByTestId(`restock-row-${id}`)).toBeVisible();

    await userEvent.click(canvas.getByTestId("restock-filter-clear"));
    await waitFor(() => expect(location).not.toHaveTextContent("courier="));
    for (const id of [502, 503, 505]) await expect(await canvas.findByTestId(`restock-row-${id}`)).toBeVisible();
  },
};

// …AND WHEN THE COURIER IS WHAT EMPTIES A TAB, the hint says nothing matches and offers to clear (an-empty-list-shows-a-hint)
// — not that the tab has no restocks: Dalam Perjalanan holds 501, by JNE, and none by SiCepat.
const AtNoCourierMatch = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe /></> }],
  "/inventories/restock?status=ongoing&courier=93",
);

export const NothingMatchesNamesTheCourier: Story = {
  name: "Nothing matches, by courier",
  render: () => <AtNoCourierMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("restock-requests-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No restocks match.");
    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));

    await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("courier="));
    await expect(canvas.getByTestId("restock-tab-ongoing")).toHaveAttribute("aria-selected", "true");
  },
};
