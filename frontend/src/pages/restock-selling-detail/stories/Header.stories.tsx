import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { patchRestock } from "../../../../.storybook/restockStub";
import { At502, At503, SELLING_DETAIL_META, loaded } from "./kit";

// RESTOCK SELLING DETAIL — the title row (the-restock-detail-is-the-product-pages-shape) — the order ID leading, the references
// copyable, and on a phone the bar that waits for the row and the one action as its icon.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Header",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE BAR WAITS FOR THE WHOLE TITLE ROW (owner, a screenshot: *"mobile heading bug seperti ini"*) — on a phone the status
// wraps under the order id and the tracking number sits under that; watching the heading alone showed the bar while those
// still stood below it, so both read twice. Scrolled a few pixels at a time: whenever the bar shows, nothing of the
// page's row is left under it — and it does show, once the row has gone.
export const OnAPhoneTheBarWaitsForTheWholeTitle: Story = {
  name: "Phone · bar waits for the title",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const bar = canvas.getByTestId("restock-detail-name-bar");
    const row = canvas.getByTestId("restock-detail-back").parentElement!;
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    let shownOnce = false;
    for (let y = 0; y <= 480; y += 6) {
      window.scrollTo(0, y);
      await frames();
      if (bar.dataset.shown) {
        shownOnce = true;
        await expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(bar.getBoundingClientRect().bottom + 1);
      }
    }
    await expect(shownOnce).toBe(true);
    window.scrollTo(0, 0);
  },
};

// ONE PAGE, NO TABS — every section on it, the left column only the navigation; the ORDER ID is the title, copyable,
// with the tracking number under it; back is its icon; the restock's own number is not shown.
export const OnePageLedByTheOrderId: Story = {
  name: "Led by the order ID",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByRole("tab")).toBeNull();
    for (const key of ["delivery", "payment", "courier", "products", "note", "timeline"]) {
      await expect(canvas.getByTestId(`section-nav-${key}`)).toBeVisible();
    }
    // The value alone, no label before it (the-title-is-the-reference-alone); the tracking number under it, labelled.
    await expect(canvas.getByTestId("restock-detail-title")).toHaveTextContent(/^INV\/2026\/09\/0412$/);
    await expect(canvas.getByTestId("restock-detail-tracking")).toHaveTextContent("SCP5544332211");
    await expect(canvas.getByTestId("restock-detail-page")).not.toHaveTextContent("#503");
    await expect(canvas.getByTestId("restock-detail-back")).toHaveTextContent("");
    await expect(canvas.getByTestId("restock-detail-back")).toHaveAccessibleName("Back to Restock");
  },
};

// THE ORDER ID IS OPTIONAL — with none, the tracking number leads, alone, and there is no second line to repeat it
// (the-title-is-the-reference-alone).
export const WithNoOrderIdTheTrackingNumberLeads: Story = {
  name: "No order ID, the resi leads",
  beforeEach: () => patchRestock(501n, { invoiceRefId: "" }),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-title")).toHaveTextContent(/^JNE0123456789$/);
    await expect(canvas.getByTestId("restock-detail-tracking-copy")).toHaveAccessibleName("Copy: JNE0123456789");
    await expect(canvas.getAllByTestId("restock-detail-tracking")).toHaveLength(1);
  },
};

// ON A PHONE ONE ACTION IS ITS ICON (a-phone-header-action-is-an-icon) — arrived offers Edit Lines alone: its pencil,
// not a menu of one.
export const OnAPhoneOneActionIsItsIcon: Story = {
  name: "Phone · one action, its icon",
  render: () => <At502 />,
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("restock-action-edit-lines-502")).toHaveAccessibleName("Edit Lines");
    await expect(canvas.queryByTestId("restock-actions-502")).toBeNull();
  },
};

// THE REFERENCES COPY (the-restock-list-leads-with-its-references) — the invoice and the tracking number, as on the list.
export const TheReferencesCopy: Story = {
  name: "References copy",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-invoice-copy")).toHaveAccessibleName(/^Copy: INV\//);
    await expect(canvas.getByTestId("restock-detail-tracking-copy")).toHaveAccessibleName("Copy: JNE0123456789");
  },
};
