import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { noBatchesAt } from "../../../.storybook/batchStub";
import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Text } from "@chakra-ui/react";

import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { BatchesPage } from "./index";

// THE BATCH LIST — Gudang Pusat's (11) batches, read by its crew (batchStub.ts): six of them, newest first — a return
// of Kopi (9101), restock 503's Beras (5031, expiring in 20 days) and Teh (5032), restock 507's Teh, all used (5071,
// Habis), and restock 398's Kopi (3982, expiring in 9 days) and Gula (3981, expired 3 days ago).

const Routed = routedPage(
  [
    { path: "/inventories/batches", element: <BatchesPage /> },
    { path: "/inventories/batches/:batchId", element: <LocationProbe /> },
    { path: "/inventories/restock/:requestId", element: <Text data-testid="at-restock-detail">at-restock-detail</Text> },
  ],
  "/inventories/batches",
);

const meta = {
  title: "Pages/Inventory/Batches/BatchList",
  component: Routed,
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
  await canvas.findByTestId("batches-row-5031", {}, { timeout: 4000 });
  return canvas;
}

/**
 * THE SCREEN RULES (the-batches-follow-the-screen-rules) — the title and a line on what a batch is, the card strip
 * over the whole set, the filter strip, a row per batch: its own number with the restock it came from under it, the
 * product, whose it is, when it arrived, what is left, its cost and value, its expiry (amber within 30 days).
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("batches-subtitle")).toHaveTextContent("one price");
    await expect(canvas.getByTestId("batches-stat-count")).toHaveTextContent("6");
    await expect(canvas.getByTestId("batches-stat-expiring")).toHaveTextContent("3");

    // Its own number, the restock under it — two batches of one restock no longer read alike; no resi
    // (a-batch-opens-where-it-came-from).
    await expect(canvas.getByTestId("batches-row-5031")).toHaveTextContent("#5031");
    await expect(canvas.getByTestId("batches-source-5031")).toHaveTextContent(/^Restock #503$/);
    await expect(canvas.getByTestId("batches-row-5031")).not.toHaveTextContent("SCP5544332211");
    await expect(canvas.getByTestId("batches-row-5032")).toHaveTextContent("#5032");
    await expect(canvas.getByTestId("batches-row-9101")).toHaveTextContent("Return");

    await expect(canvas.getByTestId("batches-depleted-5071")).toHaveTextContent("Depleted");
    await waitFor(() => expect(canvas.getByTestId("batches-row-5031")).toHaveTextContent("Toko Melati"));
    // Whose goods: always a selling team, so the small avatar and the name, no type badge
    // (a-team-of-a-known-type-shows-no-badge).
    await expect(canvas.getByTestId("batches-team-5031")).toHaveTextContent("Toko Melati");
    await expect(canvas.getByTestId("batches-team-5031")).not.toHaveTextContent("Selling");
    await expect(canvas.getByTestId("batches-pager")).toBeVisible();
  },
};

// A PHONE (every-page-has-a-mobile-story) — each batch is a block (a-phone-reads-each-line-as-a-block): its number and
// date, the product, whose it is, *Siap 7 · Rp … × 7 … Rp …*, where it came from and when it expires; the filters are
// in a sheet; nothing runs past the screen's edge.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryAllByRole("columnheader")).toHaveLength(0);
    await expect(canvas.getByTestId("batches-row-5031")).toHaveTextContent("Ready 7");
    await expect(canvas.queryByTestId("batches-expiry-trigger")).toBeNull();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// WHAT A BATCH IS (a-batch-says-what-it-is) — a tooltip on "What is a batch?": it says it and draws an example.
export const WhatIsABatch: Story = {
  name: "What is a batch",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(screen.queryByTestId("batch-explainer-panel")).toBeNull();
    await userEvent.hover(canvas.getByTestId("batch-explainer-toggle"));
    const panel = await screen.findByTestId("batch-explainer-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await expect(panel).toHaveTextContent("one price");
    await expect(panel).toHaveTextContent("oldest batch first");
    await expect(within(panel).getByTestId("batch-explainer-example")).toHaveTextContent("Restock #503 accepted");
  },
};

// THE SEARCH — a batch's number, a restock's, a resi, a SKU or a name; the figures follow the narrowed list.
export const Search: Story = {
  name: "Search",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("batches-search"), "teh", { delay: 30 });
    await waitFor(() => expect(canvas.queryByTestId("batches-row-5031")).toBeNull());
    await expect(canvas.getByTestId("batches-row-5032")).toBeInTheDocument();
    await expect(canvas.getByTestId("batches-row-5071")).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByTestId("batches-stat-count")).toHaveTextContent("2"));
  },
};

// EXPIRING WITHIN 30 DAYS — the plain list's pick, cleared from its own ×.
export const ExpiringSoon: Story = {
  name: "Expiring soon",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("batches-expiry-trigger"));
    const option = await canvas.findByTestId("batches-expiry-option-1");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.queryByTestId("batches-row-5032")).toBeNull());
    await expect(canvas.getByTestId("batches-row-5031")).toBeInTheDocument();
    await expect(canvas.getByTestId("batches-row-3982")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("batches-expiry-clear"));
    await expect(await canvas.findByTestId("batches-row-5032")).toBeInTheDocument();
  },
};

// WHOSE GOODS (the-batch-list-filters-by-team) — a search select over the selling teams, the pick its name alone; it is
// held and counted as a filter, but narrows nothing yet: its ⚠ says so, every batch stays, and Hapus Filter clears it.
export const TeamFilter: Story = {
  name: "Team filter",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const field = canvas.getByTestId("batches-team-filter");

    await expect(within(field).getByTestId("not-implemented-teamFilter")).toHaveTextContent("2");

    // TeamSelect portals, so its option is on the screen.
    await userEvent.type(within(field).getByRole("combobox"), "SL-01", { delay: 40 });
    const option = await screen.findByTestId("team-select-option-SL-01");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(within(field).getByRole("combobox")).toHaveValue("Toko Melati"));
    await expect(within(field).queryByText("Selling")).toBeNull();

    // Thrown away: the list is the whole list still.
    await expect(canvas.getByTestId("batches-row-9101")).toBeInTheDocument();
    await expect(canvas.getByTestId("batches-stat-count")).toHaveTextContent("6");

    await userEvent.click(canvas.getByTestId("batches-filter-clear"));
    await waitFor(() => expect(within(field).getByRole("combobox")).toHaveValue(""));
  },
};

// AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint) — no match: clear the filters.
export const NothingMatches: Story = {
  name: "Nothing matches",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("batches-search"), "zzz", { delay: 30 });
    const empty = await canvas.findByTestId("batches-empty", {}, { timeout: 4000 });
    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));
    await expect(await canvas.findByTestId("batches-row-5031")).toBeInTheDocument();
  },
};

// …and a warehouse with no batches is told where they come from.
export const NoBatchesYet: Story = {
  name: "No batches yet",
  beforeEach: () => noBatchesAt(11n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const empty = await canvas.findByTestId("batches-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("No batches yet");
    await expect(empty).toHaveTextContent("when a restock is accepted");
  },
};

// THE SKU COPIES (sku-is-copyable) — a click on it reports ✓ or ⚠ and does not open the batch.
export const SkuCopies: Story = {
  name: "SKU copies",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const sku = canvas.getByTestId("batches-sku-5031");

    await expect(sku).toHaveTextContent("SKU-BERAS-5K");
    await userEvent.click(sku);
    await waitFor(() => expect(sku.hasAttribute("data-copied") || sku.hasAttribute("data-copy-failed")).toBe(true));
    await expect(screen.queryByTestId("location-search")).toBeNull();
  },
};

// THE EXPIRY (an-expiry-says-how-long-is-left) — the day alone, the size of Tiba, and how long is left under it: amber
// within 30 days, red once past, quiet beyond; no expiry is a dash.
export const ExpiryCell: Story = {
  name: "Expiry",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("batches-expiry-5031")).toHaveTextContent(/^\d{1,2} \w{3}$/);
    await expect(canvas.getByTestId("batches-expiry-5031-left")).toHaveTextContent("20 days left");
    await expect(canvas.getByTestId("batches-expiry-5031-left")).toHaveAttribute("data-band", "soon");
    await expect(canvas.getByTestId("batches-expiry-3981-left")).toHaveTextContent("expired 3 days ago");
    await expect(canvas.getByTestId("batches-expiry-3981-left")).toHaveAttribute("data-band", "past");
    await expect(canvas.getByTestId("batches-expiry-5032-left")).toHaveAttribute("data-band", "later");
    await expect(canvas.getByTestId("batches-expiry-5071")).toHaveTextContent("—");
    // The same size as Tiba beside it.
    await expect(getComputedStyle(canvas.getByTestId("batches-expiry-5031")).fontSize).toBe("12px");
  },
};

// WHERE IT CAME FROM, AS A WAY THERE (a-batch-opens-where-it-came-from) — *Restock #503* opens the restock, not the batch;
// a return says *Return* with its ⚠: a batch does not know its return's number yet.
export const OpensItsSource: Story = {
  name: "Opens its source",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("batches-source-9101")).getByTestId("not-implemented-returnLink")).toBeVisible();
    // A return's source and the team filter (pages/batches/pending.ts) — the return keeps its 1 on both batch screens.
    await expect(canvas.getByTestId("not-implemented-summary")).toHaveTextContent("2 parts of this screen are not implemented yet");
    await expect(within(canvas.getByTestId("batches-source-9101")).getByTestId("not-implemented-returnLink")).toHaveTextContent("1");

    await userEvent.click(canvas.getByTestId("batches-source-5031"));
    await canvas.findByTestId("at-restock-detail");
    await expect(screen.queryByTestId("location-search")).toBeNull();
  },
};

// A row opens the batch's page.
export const OpensItsPage: Story = {
  name: "Opens its page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("batches-row-5031"));
    await expect(await screen.findByTestId("location-search")).toBeInTheDocument();
  },
};

// Warehouse-only: a selling team's goods are batched in the warehouse that holds them.
export const ASellingTeam: Story = {
  name: "Selling team",
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("batches-not-warehouse", {}, { timeout: 4000 })).toBeVisible();
  },
};
