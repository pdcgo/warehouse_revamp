import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import {
  ACCEPTED_HERE,
  ASKED_LONG_AGO,
  KENANGA,
  RETURNS_META,
  WAITING_HERE,
  counts,
  listedIds,
  noRowOf,
  orderById,
  routedAt,
  rowOf,
  withReturns,
} from "./kit";

// INVENTARIS › RETUR — THE TABS AND THE FILTERS (the-retur-list-prototype-is-accepted: search, *Diminta* date, seller,
// marketplace, courier; tabs and filters kept in the URL, a-lists-filters-live-in-the-url). Each narrows the rows AND the
// tab counts — the list and the stat are sent one filter — and an address carrying them opens the same narrowed list: a
// reload, a bookmark, Back from a row.

const meta = {
  title: "Pages/Warehouse/ReturnsPage/Filters",
  ...RETURNS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The team filter's field, as the picker shows the picked seller. */
const teamFilterInput = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByTestId("return-list-team-filter")).getByRole("combobox");

/** THE TAB AND THE FILTERS ARE WRITTEN TO THE URL as they are picked. */
export const TheTabAndFiltersLiveInTheUrl: Story = {
  name: "The tab and filters live in the URL",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);

    await userEvent.click(canvas.getByTestId("return-list-tab-accepted"));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("state=accepted"));

    await userEvent.type(canvas.getByTestId("return-list-search"), "Citra", { delay: 30 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("q=Citra"));

    await pickTeam(canvas.getByTestId("return-list-team-filter"), "SL-01");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("team=12"));
    await rowOf(canvasElement, 103n);
    await noRowOf(canvasElement, 104n);
  },
};

const KenangaAccepted = routedAt(`?state=accepted&team=${KENANGA}`);

/**
 * …AND AN ADDRESS WITH THEM OPENS THE SAME LIST — a reload: Kenanga's one accepted return on Sudah diterima, the seller in
 * its field, the counts Kenanga's own.
 */
export const AnAddressOpensTheSameList: Story = {
  name: "An address opens the same list",
  render: () => <KenangaAccepted />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 111n);

    await expect(canvas.getByTestId("return-list-tab-accepted")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(listedIds(canvasElement)).toEqual(["111"]));
    await counts(canvasElement, 1, 1);
    await waitFor(() => expect(teamFilterInput(canvasElement)).toHaveValue("Toko Kenanga"));
  },
};

/**
 * BACK FROM A ROW COMES BACK FILTERED: the seller picked, Terima opens the accept page carrying the address, and its Back
 * lands on the same narrowed list — the filter still in its field and in the URL.
 */
export const TheFiltersComeBackFromTheAcceptPage: Story = {
  name: "The filters come back from the accept page",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 110n);

    await pickTeam(canvas.getByTestId("return-list-team-filter"), "SL-01");
    await noRowOf(canvasElement, 110n);
    // The filter's own URL write (a gathered `replace`) can land after the rows — wait for it, as a person's click would.
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("team=12"));
    await userEvent.click(canvas.getByTestId("return-list-accept-101"));
    await waitFor(() => expect(canvas.getByTestId("at-return-accept-from")).toHaveTextContent("/inventories/returns?team=12"));

    await userEvent.click(canvas.getByTestId("at-return-accept-back"));
    await rowOf(canvasElement, 101n);
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("team=12");
    await noRowOf(canvasElement, 110n);
    await counts(canvasElement, WAITING_HERE.length - 1, ACCEPTED_HERE.length - 1);
    await waitFor(() => expect(teamFilterInput(canvasElement)).toHaveValue("Toko Melati"));
  },
};

/** THE CREW'S FILTERS narrow the rows and the tab counts alike — the seller here; a resi from a parcel's label below. */
export const TheFiltersNarrowRowsAndCounts: Story = {
  name: "The filters narrow rows and counts",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 101n);

    await pickTeam(canvas.getByTestId("return-list-team-filter"), "SL-02");
    await rowOf(canvasElement, 110n);
    await noRowOf(canvasElement, 101n);
    await counts(canvasElement, 1, 1);

    // A resi from a parcel's label finds its one return.
    await userEvent.click(canvas.getByTestId("return-list-filters-clear"));
    await rowOf(canvasElement, 101n);
    await userEvent.type(canvas.getByTestId("return-list-search"), orderById(102n).receiptCode, { delay: 20 });
    await noRowOf(canvasElement, 101n);
    await rowOf(canvasElement, 102n);
    await counts(canvasElement, 1, 0);
  },
};

/**
 * THE DATE WINDOW READS WHEN THE RETURN WAS ASKED — the trigger says *Asked*; the last month leaves out the return asked
 * 120 days ago, in the rows and the counts, and is kept in the URL. (Waiting returns only: the stub dates a fixture's
 * claim six days after it was placed, which for an accepted fixture order is still ahead.)
 */
export const TheAskedWindowNarrowsRowsAndCounts: Story = {
  name: "The asked window narrows rows and counts",
  beforeEach: withReturns({ accepted: [] }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, ASKED_LONG_AGO);
    await expect(canvas.getByTestId("return-list-date-field-label")).toHaveTextContent("Asked");

    await userEvent.click(canvas.getByTestId("return-list-date"));
    const lastMonth = await screen.findByTestId("return-list-date-quick-1m");
    await waitFor(() => expect(lastMonth).toBeVisible());
    await userEvent.click(lastMonth);

    await noRowOf(canvasElement, ASKED_LONG_AGO);
    await rowOf(canvasElement, 101n);
    await counts(canvasElement, WAITING_HERE.length - 1, 0);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("range=1m"));
  },
};

const LazadaByCourier95 = routedAt(`?state=all&marketplace=${Marketplace.LAZADA}&courier=95`);

/** THE MARKETPLACE AND THE COURIER narrow together — from an address: Lazada by courier 95 is one accepted return. */
export const TheMarketplaceAndCourierNarrow: Story = {
  name: "The marketplace and courier narrow",
  render: () => <LazadaByCourier95 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, 104n);

    await expect(canvas.getByTestId("return-list-tab-all")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(listedIds(canvasElement)).toEqual(["104"]));
    await counts(canvasElement, 0, 1);
  },
};
