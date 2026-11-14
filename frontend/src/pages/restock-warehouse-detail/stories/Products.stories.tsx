import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { besideTheOpenSidebar } from "../../../../.storybook/pageStory";
import { kirimanPlacement } from "../../../features/restock/storyLayout";
import { At503, WAREHOUSE_DETAIL_META, loaded } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the lines as counted — missing, broken with its photo, where the good units went.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Products",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE BROKEN UNITS' PHOTO (a-broken-product-carries-a-photo) — 503's rice: a thumbnail beside the broken count that opens
// the photo whole. A SAMPLE, the page's second mark (after the charge at Tiba); the tea, nothing broken, has none.
export const TheBrokenCountShowsItsPhoto: Story = {
  name: "Broken photo",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const cell = canvas.getByTestId("restock-detail-broken-74");
    await expect(within(cell).getByTestId("not-implemented-brokenPhoto")).toHaveTextContent("2");
    await expect(canvas.queryByTestId("restock-detail-broken-photo-72")).toBeNull();

    await userEvent.click(within(cell).getByTestId("restock-detail-broken-photo-74-open"));
    const whole = await screen.findByTestId("restock-detail-broken-photo-74-dialog");
    await waitFor(() => expect(whole).toBeVisible());
    await expect(within(whole).getByRole("img")).toBeVisible();
  },
};

// The lines as counted: Missing, never Lost (a-short-unit-at-the-door-is-missing), and WHERE the good units went, by
// placement code (there-is-no-unplaced-pile).
export const TheCountAndThePlacements: Story = {
  name: "Count and placements",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = canvas.getByTestId("restock-detail-items");
    await expect(canvas.getByTestId("restock-detail-col-missing")).toHaveTextContent("Missing");
    await expect(within(table).queryByRole("columnheader", { name: /^Lost/ })).toBeNull();
    await expect(canvas.getByTestId("restock-detail-missing-74-count")).toHaveTextContent("1");
    await expect(canvas.getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");

    await waitFor(() => expect(canvas.getByTestId("restock-detail-placement-74")).toHaveTextContent("A-01-1 (5), B-02-1 (2)"));
    await expect(canvas.getByTestId("restock-detail-placement-72")).toHaveTextContent("A-01-2 (20)");
  },
};

// THE STATISTICS LEAD THE BOX (owner: *"di produk kasih statistik"*, the-restock-page-leads-with-the-box) — 503: 2 products,
// 30 pcs ordered; 29 came, 27 good, 2 broken, 1 short. Before the count (501) the four read "—", not counted yet.
export const TheStatisticsLeadTheBox: Story = {
  name: "Statistics",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-stat-products")).toHaveTextContent(/Products2.*30 pcs ordered/);
    await expect(canvas.getByTestId("restock-detail-stat-received")).toHaveTextContent(/29 pcs.*of 30 ordered/);
    await expect(canvas.getByTestId("restock-detail-stat-good")).toHaveTextContent("27 pcs");
    await expect(canvas.getByTestId("restock-detail-stat-broken")).toHaveTextContent("2 pcs");
    await expect(canvas.getByTestId("restock-detail-stat-missing")).toHaveTextContent("1 pc");
  },
};

export const TheStatisticsWaitForTheCount: Story = {
  name: "Statistics · not counted",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-stat-received")).toHaveTextContent(/—.*Not counted yet/);
    await expect(canvas.getByTestId("restock-detail-stat-missing")).toHaveTextContent("—");
  },
};

// WHERE THE BROKEN UNITS WENT (owner: *"tampilkan"*, the-detail-pages-show-the-slip-and-the-broken-rack) — under the good
// units' places, when they were put on a rack. A SAMPLE, the page's third mark — and against a business decision, which the
// strip says (a-conflict-with-a-business-decision-is-said-in-its-mark). The tea, nothing broken, has none.
export const TheBrokenRackIsUnderThePlaces: Story = {
  name: "Broken rack",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    // The rack codes arrive in their own read, after the lines.
    const rack = await canvas.findByTestId("restock-detail-broken-rack-74", {}, { timeout: 4000 });

    await expect(rack).toHaveTextContent(/^Broken 2 → \S+/);
    await expect(within(rack).getByTestId("not-implemented-brokenRack")).toHaveTextContent("3");
    await expect(canvas.queryByTestId("restock-detail-broken-rack-72")).toBeNull();

    await userEvent.click(canvas.getByTestId("not-implemented-toggle"));
    const conflict = await canvas.findByTestId("pending-row-brokenRack-conflict");
    await waitFor(() => expect(conflict).toBeVisible());
  },
};

// IT FITS BESIDE THE OPEN SIDEBAR (backlog #48) — at 1600px the app's sidebar (258px and its border; open by default,
// the-sidebar-collapses-to-its-icons) leaves the products column 681px beside the nav and Kiriman's 20rem, and the table
// needed 947: it scrolled sideways and cut Placement. Now no column holds it wider than its words must — the product's name
// and the problem's note give way, the places wrap — so nothing scrolls and Placement is on screen. A page story has no
// sidebar of its own, so the story stands one of its width beside the page. At 1600 the area still holds both, so Kiriman
// stays beside the products (the-delivery-card-stacks-when-the-page-is-narrow — narrower, it goes below: ./Layout.stories).

export const FitsBesideTheOpenSidebar: Story = {
  name: "Fits beside the open sidebar",
  render: () => <At503 />,
  globals: { viewport: { value: "desktop1600" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(1600);
    await expect(kirimanPlacement(canvasElement)).toBe("beside");

    const table = canvas.getByTestId("restock-detail-items");
    const scroller = table.parentElement!;
    await waitFor(() => expect(canvas.getByTestId("restock-detail-placement-74")).toHaveTextContent("A-01-1 (5), B-02-1 (2)"));

    // No sideways scroll…
    await expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
    // …and Placement whole inside the table's box, beside the counts.
    const placement = within(table).getByRole("columnheader", { name: "Placement" });
    await expect(placement).toBeVisible();
    await expect(placement.getBoundingClientRect().right).toBeLessThanOrEqual(scroller.getBoundingClientRect().right + 0.5);
    // The worth still whole (backlog #46), the note's words still in its tooltip.
    await expect(canvas.getByTestId("restock-detail-broken-74-value")).toHaveTextContent("worth Rp 132.333,333");
    await expect(canvas.getByTestId("restock-detail-broken-74-note").parentElement).toHaveAttribute("title", "Karung sobek");
  },
};

// WHAT A BROKEN OR MISSING ROW WAS WORTH IS NEVER CUT (backlog #46, the-problem-price-is-filled-by-the-system): the two
// columns are narrow, and their second line used to wrap inside a one-line clamp, so *worth Rp 132.333,333* read as
// *worth Rp…*. The worth stays whole on its line — the column fits it; only a long note is cut, its words in the tooltip.
export const TheWorthIsNeverCut: Story = {
  name: "Broken and missing · the worth is never cut",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const [id, amount] of [
      ["restock-detail-broken-74-value", "worth Rp 132.333,333"],
      ["restock-detail-missing-74-value", "worth Rp 66.166,667"],
    ] as const) {
      const value = canvas.getByTestId(id);
      await expect(value).toHaveTextContent(amount);
      // ONE line box, inside the visible part of its line and of its cell — nothing wrapped away, nothing clipped.
      await expect(value.getClientRects()).toHaveLength(1);
      const box = value.getBoundingClientRect();
      const line = value.parentElement!.getBoundingClientRect();
      const cell = value.closest("td")!.getBoundingClientRect();
      await expect(box.bottom).toBeLessThanOrEqual(line.bottom + 0.5);
      await expect(box.right).toBeLessThanOrEqual(Math.min(line.right, cell.right) + 0.5);
      await expect(box.left).toBeGreaterThanOrEqual(cell.left - 0.5);
    }
    // The note keeps its own words — whole, or cut with its tooltip.
    await expect(canvas.getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");
  },
};
