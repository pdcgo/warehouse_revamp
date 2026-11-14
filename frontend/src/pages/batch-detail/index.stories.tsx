import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { productLeftItsRacksForStory } from "../../../.storybook/batchStub";
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
    // Where it came from is Info's *From*, as a way there, no resi (a-batch-opens-where-it-came-from).
    await expect(canvas.getByTestId("batch-detail-order")).toHaveTextContent(/^Restock #503$/);
    await expect(canvas.getByTestId("batch-info-panel")).not.toHaveTextContent("SCP5544332211");
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
// icon); the sections' chips stick at the top in place of the nav; nothing runs past the screen's edge.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("batch-detail-adjust")).toHaveAccessibleName("Adjust");
    await expect(canvas.getByTestId("batch-detail-adjust")).toHaveTextContent("");
    await expect(canvas.getByTestId("section-nav-strip")).toBeVisible();
    await expect(canvas.queryByTestId("section-nav")).toBeNull();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// ONE PAGE OF SECTIONS, IN THE NAV'S ORDER (a-batch-page-is-one-page-of-sections) — where it was put, the batch's own
// record, what has happened to it; none behind a tab. Info holds the record the heading used to: where it came from, who
// took it in, what a unit cost, when it expires.
export const OnePageOfSections: Story = {
  name: "One page of sections",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const nav = canvas.getByTestId("section-nav");

    await expect([...nav.querySelectorAll<HTMLElement>("[data-section]")].map((el) => el.dataset.section)).toEqual([
      "placements",
      "info",
      "history",
    ]);
    await expect(canvas.getByTestId("section-nav-placements")).toHaveAttribute("aria-current", "location");
    for (const panel of ["placements", "info", "history"]) {
      await expect(canvas.getByTestId(`batch-${panel}-panel`)).toBeInTheDocument();
    }
    await expect(canvas.queryByRole("tablist")).toBeNull();

    const info = canvas.getByTestId("batch-info-panel");
    for (const label of ["From", "Accepted by", "Unit cost", "Expiry"]) {
      await expect(info).toHaveTextContent(label);
    }
    await expect(info).not.toHaveTextContent("batchDetail.");
    await expect(within(info).getByTestId("batch-detail-unit-cost")).toHaveTextContent(/^Rp/);
    // The expiry as the list says it — the day, and how long is left, amber within 30 days (an-expiry-says-how-long-is-left).
    await expect(within(info).getByTestId("batch-detail-expiry-left")).toHaveAttribute("data-band", "soon");

    // A nav click jumps there and lights it (a-nav-jump-blinks-where-it-lands).
    await userEvent.click(canvas.getByTestId("section-nav-history"));
    await waitFor(() => expect(canvas.getByTestId("section-nav-history")).toHaveAttribute("aria-current", "location"));
  },
};

// THE HEADING STICKS ONCE IT HAS SCROLLED AWAY (the-title-row-is-the-sticky-bar) — hidden while it is on screen; after a
// jump down the page, the number in small with the product under it, back, and Koreksi as its icon.
export const TheTitleSticks: Story = {
  name: "Title sticks",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const bar = canvas.getByTestId("batch-detail-name-bar");

    await expect(bar).not.toHaveAttribute("data-shown");
    await userEvent.click(canvas.getByTestId("section-nav-history"));
    await waitFor(() => expect(bar).toHaveAttribute("data-shown"));
    await expect(bar).toHaveTextContent("Batch #5031");
    await expect(bar).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(within(bar).getByTestId("batch-detail-sticky-back")).toBeVisible();
    await expect(within(bar).getByTestId("batch-detail-adjust-sticky")).toBeVisible();
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

    // On the page — no tab to open first.
    const table = await within(canvas.getByTestId("batch-history-panel")).findByTestId(
      "batch-detail-history-table",
      {},
      { timeout: 4000 },
    );
    await expect(table).toHaveTextContent("A-01-1");
    await expect(table).toHaveTextContent("B-02-1");
  },
};

// THE RACK EACH MOVEMENT TOUCHED (backlog #47) — Riwayat's Rak names it on every row: 5031's put-away, one row per rack,
// A-01-1 and B-02-1; "Unplaced" never, as each of its rows touched a rack. Named from the warehouse's racks, so a
// rack the product has LEFT since (it sits on none now — ProductPlaces lists only racks holding it) still reads by its
// code, never "#41"; the put-away (Ditaruh) too.
export const HistoryNamesEachRack: Story = {
  name: "History names each rack",
  beforeEach: () => productLeftItsRacksForStory(74n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = await within(canvas.getByTestId("batch-history-panel")).findByTestId(
      "batch-detail-history-table",
      {},
      { timeout: 4000 },
    );
    await waitFor(() => expect(table).toHaveTextContent("B-02-1"));
    const rows = within(table).getAllByTestId(/^batch-detail-history-row-\d+$/);
    await expect(rows).toHaveLength(2);
    for (const row of rows) {
      await expect(row).toHaveTextContent(/A-01-1|B-02-1/);
      await expect(row).not.toHaveTextContent(/#\d|Unplaced/);
    }

    const placed = canvas.getByTestId("batch-placements-panel");
    await expect(placed).toHaveTextContent("A-01-1");
    await expect(placed).toHaveTextContent("B-02-1");
    await expect(placed).not.toHaveTextContent(/#\d/);
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
