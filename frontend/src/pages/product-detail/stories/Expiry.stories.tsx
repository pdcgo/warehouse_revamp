import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { besideTheOpenSidebar } from "../../../../.storybook/pageStory";
import { ownerBatchExpiriesForStory } from "../../../../.storybook/productStub";
import { PRODUCT_DETAIL_META, loaded, sectionOf } from "./kit";

// THE OWNING TEAM READS EXPIRY ON ITS PRODUCT PAGE (owner: *"A"*, the-expiry-report-is-the-batch-list; accepted as shown,
// the-expiry-prototypes-are-accepted): the Batch section's *Kedaluwarsa* beside *Tiba* — the day, and how long is left
// under it, as the batch screens read it (an-expiry-says-how-long-is-left): amber within 30 days, red once past, a dash
// for none. The team that marks them down sees what is close. A phone's block says it on the arrival day's line.
//
// AND THE SIDE CARDS STACK WHEN THE PAGE IS NARROW (owner: *"A"*, the-product-pages-side-cards-stack-when-narrow): the
// side cards (Cross, the derived figures) stand beside the main column only when the PAGE AREA holds the Batch section at
// its narrowest + the gap + 20rem — else they go below Batch, in their order. At 1440 with the sidebar open that is below
// (the table whole, nothing scrolls); at 1440 alone and at 1920 with the sidebar, beside.
//
// Minyak Goreng 700 (Toko Anggrek), its three batches given expiries for this story (productStub
// `ownerBatchExpiriesForStory`): 7001 in 20 days, 7002 three days ago, 7003 none.

/** The 390px phone the blocks are judged at. */
const PHONE_VIEWPORTS = {
  phone390: { name: "Phone 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
};

const meta = {
  title: "Pages/Products/ProductDetail/Expiry",
  ...PRODUCT_DETAIL_META,
  parameters: { ...PRODUCT_DETAIL_META.parameters, viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: [
    PRODUCT_DETAIL_META.beforeEach,
    () => {
      ownerBatchExpiriesForStory({ "7001": 20, "7002": -3, "7003": null });
    },
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── helpers, kept unexported (every named export is a story) ─────────────────────────────────────────────────────────

/**
 * Where the side cards (Cross first) stand against the Batch section: `beside` — to its right, in the side column;
 * `below` — under the main column's Batch, as wide as it; `other` — anything else, which no layout should draw.
 */
function sideCards(root: HTMLElement): "beside" | "below" | "other" {
  const rect = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect();
  const batch = rect("pd-section-batch");
  const cross = rect("pd-section-cross");
  if (cross.left >= batch.right) return "beside";
  if (cross.top >= batch.bottom && Math.abs(cross.left - batch.left) < 1 && Math.abs(cross.width - batch.width) < 1) {
    return "below";
  }
  return "other";
}

/** The Batch table never scrolls sideways in its own box, and the page never does. */
async function expectTheBatchTableFits(root: HTMLElement) {
  const scroll = root.querySelector<HTMLElement>('[data-testid="pd-batch-scroll"]')!;
  await waitFor(() => expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth));
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

// ── the stories ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * EACH BATCH SAYS WHEN IT EXPIRES — 1440 beside the open sidebar: *Kedaluwarsa* after *Tiba*; 7001 *20 days left* in
 * amber, 7002 *expired 3 days ago* in red, 7003 a dash. The area cannot hold the Batch table beside the side cards, so
 * they go below it, and the table is whole.
 */
export const EachBatchSaysWhenItExpires: Story = {
  name: "Each batch's expiry · side cards below (1440 beside the sidebar)",
  globals: { viewport: { value: "desktop1440" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(1440);
    const batch = await sectionOf(canvas, "batch");
    await batch.findByTestId("pd-batch-row-7001", {}, { timeout: 4000 });

    const headers = within(batch.getByTestId("pd-batch-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    await expect(headers.indexOf("Expiring")).toBe(headers.indexOf("Arrived") + 1);

    await expect(batch.getByTestId("pd-batch-expiry-7001-left")).toHaveTextContent("20 days left");
    await expect(batch.getByTestId("pd-batch-expiry-7001-left")).toHaveAttribute("data-band", "soon");
    await expect(batch.getByTestId("pd-batch-expiry-7002-left")).toHaveTextContent("expired 3 days ago");
    await expect(batch.getByTestId("pd-batch-expiry-7002-left")).toHaveAttribute("data-band", "past");
    await expect(batch.getByTestId("pd-batch-expiry-7003")).toHaveTextContent("—");
    // The day is 12px, as Tiba's neighbour on the batch list.
    await expect(getComputedStyle(batch.getByTestId("pd-batch-expiry-7001")).fontSize).toBe("12px");

    await expect(sideCards(canvasElement)).toBe("below");
    await expectTheBatchTableFits(canvasElement);
  },
};

/** 1920 BESIDE THE OPEN SIDEBAR — room enough: the side cards beside the main column, the table with Kedaluwarsa whole. */
export const BesideAt1920WithTheSidebar: Story = {
  name: "1920 beside the sidebar · side cards beside",
  globals: { viewport: { value: "desktop1920" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(1920);
    const batch = await sectionOf(canvas, "batch");
    await batch.findByTestId("pd-batch-expiry-7001-left", {}, { timeout: 4000 });
    await expect(sideCards(canvasElement)).toBe("beside");
    await expectTheBatchTableFits(canvasElement);
  },
};

/**
 * 1440 WITH THE SIDEBAR CLOSING — the sidebar's 259px come back to the page: the side cards move beside the main column,
 * and the table stays whole either way.
 */
export const TheSidebarClosing: Story = {
  name: "1440 · the sidebar closing moves the side cards beside",
  globals: { viewport: { value: "desktop1440" } },
  decorators: [besideTheOpenSidebar],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const batch = await sectionOf(canvas, "batch");
    await batch.findByTestId("pd-batch-row-7001", {}, { timeout: 4000 });
    await expect(sideCards(canvasElement)).toBe("below");

    const spacer = canvasElement.ownerDocument.querySelector<HTMLElement>('[data-testid="story-sidebar-width"]')!;
    spacer.style.width = "0px";
    spacer.style.minWidth = "0px";
    await waitFor(() => expect(sideCards(canvasElement)).toBe("beside"));
    await expectTheBatchTableFits(canvasElement);
  },
};

/** A PHONE — the block's arrival line says when it expires; a batch with none says nothing more. */
export const Phone: Story = {
  name: "Phone",
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(390);
    const batch = await sectionOf(canvas, "batch");
    const row = within(await batch.findByTestId("pd-batch-row-7001", {}, { timeout: 4000 }));

    await expect(row.getByTestId("pd-batch-expiry-line-7001")).toHaveTextContent("Expiring");
    await expect(row.getByTestId("pd-batch-expiry-7001-left")).toHaveTextContent("20 days left");
    await expect(within(batch.getByTestId("pd-batch-row-7002")).getByTestId("pd-batch-expiry-7002-left")).toHaveAttribute(
      "data-band",
      "past",
    );
    await expect(within(batch.getByTestId("pd-batch-row-7003")).queryByTestId("pd-batch-expiry-line-7003")).toBeNull();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
