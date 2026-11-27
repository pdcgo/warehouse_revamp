import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, pickTeam, routedPage } from "../../../../.storybook/pageStory";
import { dayKey, teams } from "../../../../.storybook/fixtures";
import { SupplierReportPage } from "../index";
import { SUPPLIER_REPORT_META, loaded, order, rp } from "./kit";

// SUPPLIER REPORT — the search (the-supplier-report-keeps-its-search), the team
// (the-team-filter-picks-any-selling-team) and the range — each narrowing the ranking and the headline, and all of
// them in the URL. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierReport/Filters",
  ...SUPPLIER_REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const KENANGA = teams.find((t) => t.id === 13n)!;

export const OneTeamPicked: Story = {
  name: "One team picked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await pickTeam(canvas.getByTestId("supplier-report-team"), KENANGA.teamCode);
  },
};

// The search finds suppliers as the supplier list does (the-supplier-report-keeps-its-search), and the headline is what
// it found: "makmur" is PT Sumber Makmur and UD Makmur Jaya — Rp 7.400.000.
export const TheSearchNarrowsTheRankingAndTheHeadline: Story = {
  name: "Search narrows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.type(canvas.getByTestId("supplier-report-search"), "makmur", { delay: 40 });

    await waitFor(() => expect(order(canvas)).toEqual(["31", "34"]), { timeout: 3000 });
    await expect(canvas.getByTestId("supplier-report-summary-restocked-value")).toHaveTextContent(rp(7_400_000n));
  },
};

// Picking a team counts only its restocks (the-team-filter-picks-any-selling-team): Toko Kenanga bought from UD Makmur
// Jaya and from PT Sumber Makmur — Rp 3.000.000 + Rp 900.000.
export const PickingATeamNarrowsTheRanking: Story = {
  name: "Team narrows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await pickTeam(canvas.getByTestId("supplier-report-team"), KENANGA.teamCode);

    await waitFor(() => expect(order(canvas)).toEqual(["34", "31"]));
    await expect(canvas.getByTestId("supplier-report-summary-restocked-value")).toHaveTextContent(rp(3_900_000n));
  },
};

// THE FILTERS AND THE ORDER LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the search and the
// order are read from it; a range picked is written back, beside them.
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/suppliers/report", element: <><SupplierReportPage /><LocationProbe /></> }],
  "/inventories/suppliers/report?q=makmur&rank=brokenRate",
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId("supplier-report-search")).toHaveValue("makmur");
    const group = canvas.getByTestId("supplier-report-rank-by");
    await expect(within(group).getByRole("radio", { name: "Broken Rate" })).toBeChecked();
    await waitFor(() => expect(order(canvas)).toEqual(["34", "31"]));

    await userEvent.click(canvas.getByTestId("supplier-report-range"));
    const week = await screen.findByTestId("supplier-report-range-quick-7");
    await waitFor(() => expect(week).toBeVisible());
    await userEvent.click(week);
    await waitFor(() => expect(location).toHaveTextContent("range=7d"));
    await expect(location).toHaveTextContent("rank=brokenRate");
  },
};

// A RANGE OVER A YEAR IS NOT LOADED (a-metric-reads-at-most-a-year; backlog #130) — the server refuses it, so it is not
// sent. Picked AFTER a loaded report — today and the 400 days before it, 401 days — the line says a year at most and
// NOTHING of the last window stays on screen: the headline `—`, no ranked row, no as-of. (TanStack kept a DISABLED
// query's last answer as its placeholder, so last month's ranking stood under the 401-day window.) A valid range again
// loads.
export const ARangeOverAYearRanksNothing: Story = {
  name: "A Range over a Year Ranks Nothing",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const today = dayKey(0);
    const from = dayKey(400);
    await waitFor(() => expect(canvas.getByTestId("supplier-report-summary-restocked-value")).toHaveTextContent(rp(9_680_000n)));
    await waitFor(() => expect(canvas.getByTestId("supplier-report-as-of")).toBeVisible(), { timeout: 3000 });

    await userEvent.click(canvas.getByTestId("supplier-report-range"));
    const end = await screen.findByTestId(`supplier-report-range-day-${today}`);
    await waitFor(() => expect(end).toBeVisible());
    await userEvent.click(end);
    for (let i = 0; i < 24 && screen.queryByTestId(`supplier-report-range-day-${from}`) === null; i++) {
      await userEvent.click(screen.getByTestId("supplier-report-range-prev"));
    }
    await userEvent.click(screen.getByTestId(`supplier-report-range-day-${from}`));
    await userEvent.click(screen.getByTestId("supplier-report-range-apply"));

    await expect(await canvas.findByTestId("supplier-report-range-invalid")).toHaveTextContent(
      "That range covers 401 days. A report reads at most 366 — pick a year at most.",
    );
    for (const card of ["total", "restocked", "sales"]) {
      await waitFor(() => expect(canvas.getByTestId(`supplier-report-summary-${card}-value`)).toHaveTextContent("—"));
    }
    await expect(canvas.queryByTestId("supplier-report-table")).toBeNull();
    await expect(canvas.queryAllByTestId(/^supplier-report-row-/)).toHaveLength(0);
    await expect(canvas.getByTestId("supplier-report-empty")).toBeVisible();
    await expect(canvas.queryByTestId("supplier-report-as-of")).toBeNull();
    await expect(canvas.queryByTestId("supplier-report-error")).toBeNull();

    // The last year — a valid window — loads again.
    await userEvent.click(canvas.getByTestId("supplier-report-range"));
    const quick = await screen.findByTestId("supplier-report-range-quick-12m");
    await waitFor(() => expect(quick).toBeVisible());
    await userEvent.click(quick);
    await canvas.findByTestId("supplier-report-table", {}, { timeout: 3000 });
    await expect(canvas.queryByTestId("supplier-report-range-invalid")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("supplier-report-summary-restocked-value")).not.toHaveTextContent("—"));
    await waitFor(() => expect(canvas.getByTestId("supplier-report-as-of")).toBeVisible(), { timeout: 3000 });
  },
};
