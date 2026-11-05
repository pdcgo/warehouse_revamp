import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIER_REPORT_META, loaded, order } from "./kit";

// SUPPLIER REPORT — the order — by restocked value, or by broken rate above its minimum (rate-ranking-needs-50-units)
// — a segmented choice (a-segmented-choice-is-in-the-main-tone) with its arrow. The page's stories are grouped by the
// part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierReport/Order",
  ...SUPPLIER_REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ByBrokenRate: Story = {
  name: "By broken rate",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-report-rank-by-rate"));
  },
};

// By restocked value, the largest first — another team's supplier beside ours (every-selling-team-sees-every-teams-figures),
// and a DELETED one ranked with its figures kept, marked (a-deleted-supplier-is-kept-for-its-figures).
export const RankedByRestockedValue: Story = {
  name: "By restocked value",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(order(canvas)).toEqual(["31", "34", "36", "38", "37"]);
    await expect(canvas.getAllByTestId("supplier-report-rank").map((cell) => cell.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    await expect(within(canvas.getByTestId("supplier-report-row-38")).getByTestId("supplier-report-deleted")).toBeVisible();
  },
};

// By broken rate, a supplier needs 50 units to be rated against the others (rate-ranking-needs-50-units): Linen House's
// 40% on five units does not top UD Makmur Jaya's 4,7% on 212. It follows, its rate muted — and the page says why.
// The three under the minimum follow in KEY order, the newest id first — not by a rate that means nothing on so few
// units (a-rate-ranks-only-above-its-minimum-sample).
export const RankedByRateNeedsFiftyUnits: Story = {
  name: "Rate needs 50 units",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-report-rank-by-rate"));

    await waitFor(() => expect(order(canvas)).toEqual(["34", "31", "38", "37", "36"]));

    const rateOf = (id: string) => within(canvas.getByTestId(`supplier-report-row-${id}`)).getByTestId("figure-broken-rate");
    await expect(rateOf("37")).toHaveAttribute("data-muted", "true");
    await expect(rateOf("34")).not.toHaveAttribute("data-muted");
    await expect(canvas.getByTestId("supplier-report-rate-note")).toHaveTextContent("fewer than 50 units");
  },
};

// THE ORDER IS A SEGMENTED CHOICE — a radio group, Nilai direstok chosen first; choosing the other moves the choice.
export const TheOrderIsASegmentedChoice: Story = {
  name: "Segmented choice",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const group = canvas.getByTestId("supplier-report-rank-by");
    await expect(group).toHaveAttribute("role", "radiogroup");
    await expect(within(group).getByRole("radio", { name: "Restocked Value" })).toBeChecked();

    await userEvent.click(canvas.getByTestId("supplier-report-rank-by-rate"));
    await waitFor(() => expect(within(group).getByRole("radio", { name: "Broken Rate" })).toBeChecked());
  },
};

// THE ORDER READS AS AN ORDER — "Sort" before it, and each segment the sort-down arrow (the-report-order-shows-its-arrow).
export const TheOrderShowsItsArrow: Story = {
  name: "Sort arrow",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const group = canvas.getByTestId("supplier-report-rank-by");
    await expect(group.parentElement).toHaveTextContent(/^Sort/);
    await expect(group.querySelectorAll("svg.lucide-arrow-down-wide-narrow")).toHaveLength(2);
  },
};
