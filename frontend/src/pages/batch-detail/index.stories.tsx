import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { BatchDetailPage } from "./index";

// ONE BATCH — Gudang Pusat's (11), read by its crew (batchStub.ts). 5031 is restock 503's Beras: 10 arrived, 2 broken,
// 1 missing, 7 ready, put on A-01-1 (5) and B-02-1 (2), expiring in 20 days. 9101 is a return of Kopi. 5071 is Teh,
// all used.

function routes() {
  return [
    { path: "/inventories/batches/:batchId", element: <BatchDetailPage /> },
    marker("/inventories/batches", "at-batch-list"),
    marker("/inventories/restock/:requestId", "at-restock-detail"),
  ];
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const At5031 = routedPage(routes(), "/inventories/batches/5031");
const At9101 = routedPage(routes(), "/inventories/batches/9101");
const At404 = routedPage(routes(), "/inventories/batches/4040");
const FromTheList = routedPage(
  [
    { path: "/inventories/batches/:batchId", element: <BatchDetailPage /> },
    { path: "/inventories/batches", element: <LocationProbe /> },
  ],
  { pathname: "/inventories/batches/5031", state: { from: "/inventories/batches?q=beras" } },
);

const meta = {
  title: "Pages/Inventory/Batches/BatchDetail",
  component: At5031,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("batch-detail-page", {}, { timeout: 4000 });
  return canvas;
}

/**
 * THE SCREEN RULES (the-batches-follow-the-screen-rules) — the title is the batch's OWN number, where it came from and
 * that it expires soon beside it, Koreksi with its icon; the product and whose it is; the lifecycle as the card strip,
 * Tiba = Rusak + Hilang + Terpakai + Siap; the racks it was put on.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("batch-detail-name")).toHaveTextContent("Batch #5031");
    await expect(canvas.getByTestId("batch-detail-origin")).toHaveTextContent("Restock");
    await expect(canvas.getByTestId("batch-detail-expiring")).toBeVisible();
    await expect(canvas.getByTestId("batch-detail-order")).toHaveTextContent(/^From Restock #503$/);
    await expect(canvas.getByTestId("batch-detail-receipt-order")).not.toHaveTextContent("SCP5544332211");
    await expect(canvas.getByTestId("batch-detail-back")).toHaveTextContent("");
    await expect(canvas.getByTestId("batch-detail-adjust").querySelector("svg")).not.toBeNull();

    await expect(canvas.getByTestId("batch-detail-arrived")).toHaveTextContent("10");
    await expect(canvas.getByTestId("batch-detail-broken")).toHaveTextContent("2");
    await expect(canvas.getByTestId("batch-detail-lost")).toHaveTextContent("1");
    await expect(canvas.getByTestId("batch-detail-ready")).toHaveTextContent("7");

    await waitFor(() => expect(canvas.getByTestId("batch-detail-shelf-41")).toHaveTextContent("A-01-1"));
    await expect(canvas.getByTestId("batch-detail-shelf-43")).toHaveTextContent("2");

    // THE SKU COPIES (sku-is-copyable).
    await expect(canvas.getByTestId("product-list-item-sku-74")).toHaveTextContent("SKU-BERAS-5K");

    // Whose goods: the small avatar and the name, no type badge (a-team-of-a-known-type-shows-no-badge).
    const owner = await canvas.findByTestId("batch-detail-owner");
    await expect(owner).toHaveTextContent("Toko Melati");
    await expect(owner).not.toHaveTextContent("Selling");
  },
};

// A PHONE (every-page-has-a-mobile-story) — the title's row is one row, Koreksi its icon (a-phone-header-action-is-an-
// icon); the tabs run across the top; nothing runs past the screen's edge.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("batch-detail-adjust")).toHaveAccessibleName("Adjust");
    await expect(canvas.getByTestId("batch-detail-adjust")).toHaveTextContent("");
    await expect(canvas.getByTestId("batch-detail-tabs")).toHaveAttribute("data-orientation", "horizontal");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// WHAT A BATCH IS (a-batch-says-what-it-is) — the same answer as on the list, under the batch's own heading.
export const WhatIsABatch: Story = {
  name: "What is a batch",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.hover(canvas.getByTestId("batch-explainer-toggle"));
    const panel = await screen.findByTestId("batch-explainer-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await expect(panel).toHaveTextContent("value, not place");
  },
};

// ITS HISTORY — the put-away on each rack, at the accept; the reworked ledger.
export const History: Story = {
  name: "History",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("batch-detail-tab-history"));
    const table = await canvas.findByTestId("batch-detail-history-table", {}, { timeout: 4000 });
    await expect(table).toHaveTextContent("A-01-1");
    await expect(table).toHaveTextContent("B-02-1");
  },
};

// A RETURN — its origin says so, and there is no restock to open.
export const AReturn: Story = {
  name: "A return",
  render: () => <At9101 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("batch-detail-origin")).toHaveTextContent("Return");
    await expect(canvas.queryByTestId("batch-detail-order")).toBeNull();
    // It cannot open its return yet — marked (a-batch-opens-where-it-came-from).
    await expect(within(canvas.getByTestId("batch-detail-return")).getByTestId("not-implemented-returnLink")).toBeVisible();
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(canvas.queryByTestId("batch-detail-expiring")).toBeNull();
  },
};

// The restock it came from opens.
export const OpensItsRestock: Story = {
  name: "Opens its restock",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("batch-detail-order"));
    await canvas.findByTestId("at-restock-detail");
  },
};

// OPENED FROM THE LIST, BACK TO THE LIST (a-form-returns-where-it-was-opened) — with its filters.
export const BackToTheList: Story = {
  name: "Back to the list",
  render: () => <FromTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("batch-detail-back"));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=beras"));
  },
};

// Another warehouse's batch, or one that does not exist, reads as not found — with the way back.
export const NotFound: Story = {
  name: "Not found",
  render: () => <At404 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("batch-detail-error", {}, { timeout: 4000 })).toHaveTextContent("batch not found");
    await userEvent.click(canvas.getByTestId("batch-detail-back"));
    await canvas.findByTestId("at-batch-list");
  },
};
