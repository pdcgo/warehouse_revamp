import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { SHOP_ENTRIES_PATH, shopEntriesLink } from "../../features/settlement/shopEntries";
import { SettlementShopEntriesPage } from "../settlement-shop-entries";
import { SettlementReportPage } from "./index";

// THE WAY IN FROM THE REPORT (the-shop-entries-page-is-accepted: "a By shop row of the report opens it on that shop with
// the report's dates"): a By shop row of the settlement report opens that shop's own entries on the report's window.

const Routed = (initial: string) =>
  routedPage(
    [
      {
        path: "/settlement/report",
        element: (
          <>
            <SettlementReportPage />
            <LocationProbe />
          </>
        ),
      },
      {
        path: SHOP_ENTRIES_PATH,
        element: (
          <>
            <SettlementShopEntriesPage />
            <LocationProbe />
          </>
        ),
      },
    ],
    initial,
  );

const meta = {
  title: "Pages/Settlement/Report/Shop Entries Entry",
  component: SettlementReportPage,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asTeam(12n),
  render: Routed("/settlement/report"),
} satisfies Meta<typeof SettlementReportPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// A By shop row opens its shop's entries — the shop and the report's own window carried in the URL.
export const AShopRowOpensItsEntries: Story = {
  render: Routed("/settlement/report?range=3m"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId("report-group-row-21", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("report-groups-entries-hint")).toBeInTheDocument();
    await expect(within(row).getByTestId("report-group-open-21")).toBeInTheDocument();
    await expect(getComputedStyle(row).cursor).toBe("pointer");

    await userEvent.click(row);

    await expect(await canvas.findByTestId("shop-entries-page")).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("shop=21&range=3m"));
    // Melati Official's own entries only: the report book's 200.000 withdrawal among them.
    await expect(await canvas.findByTestId("shop-entry-7101")).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("5"));
    await expect(canvas.queryByTestId("shop-entry-7104")).toBeNull();
  },
};

// By person never opens shop entries — a person is not a shop.
export const AByPersonRowOpensNothing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("report-group-row-21", {}, { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("report-group-user"));
    const person = await canvas.findByTestId("report-group-row-61", {}, { timeout: 4000 });
    await expect(within(person).queryByTestId("report-group-open-61")).toBeNull();
    await userEvent.click(person);
    await expect(canvas.getByTestId("settlement-report-page")).toBeInTheDocument();
  },
};

// The link leaves the report's default window out, as every list's URL leaves its defaults out.
export const TheLinkLeavesTheDefaultWindowOut: Story = {
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByTestId("report-group-row-21", {}, { timeout: 4000 });
    await expect(shopEntriesLink(21n, { kind: "relative", months: 1 })).toBe(`${SHOP_ENTRIES_PATH}?shop=21`);
    await expect(shopEntriesLink(21n, { kind: "absolute", from: "2026-10-01", to: "2026-10-31" })).toBe(
      `${SHOP_ENTRIES_PATH}?shop=21&range=2026-10-01..2026-10-31`,
    );
  },
};
