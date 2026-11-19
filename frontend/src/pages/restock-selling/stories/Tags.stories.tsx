import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { restockExportScenario } from "../../../../.storybook/restockExportScenario";
import { restockReadScenario } from "../../../../.storybook/restockReadScenario";
import { DESKTOP, PHONE, TAG, TAG_VIEWPORTS, secondProblemRestock } from "../../../../.storybook/restockTagKit";
import { toaster } from "../../../components/feedback/Toaster";
import { RestockSellingPage } from "../index";
import { SELLING_META, loaded, openStatistics } from "./kit";

// RESTOCK SELLING — THE TAGS (backlog #87, live since the-restock-tags-prototype-is-accepted). The restock's tags as chips
// on every row (a column after the status, ALWAYS drawn — the owner's 🔄; a line in a phone's block), the system's first
// and locked, and a Tag filter beside the courier's — SEVERAL tags from the app-wide list, a restock in when it carries
// ANY (the accept's amendment), kept in the address; the statistics and Ekspor follow it (one predicate on the server).
//
// The scene (the stub, restockTagScenario.ts): Toko Melati's restocks — 501 Audit Gudang (an admin's system tag) +
// Prioritas + Lebaran 2026, 502 Prioritas, 503 (2 broken, 1 missing: the app put Barang kurang AND Barang rusak on) +
// Retur ke Supplier (the warehouse's), and 507 counted 3 short (Barang kurang). The problem tags follow
// a-restock-problem-is-a-system-tag: one per kind, put on by Terima, the restock still Diterima.

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Tags",
  ...SELLING_META,
  parameters: { ...SELLING_META.parameters, viewport: { options: TAG_VIEWPORTS } },
  beforeEach: () => {
    SELLING_META.beforeEach();
    return secondProblemRestock();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The tag filter's options — the combobox opened by a click on its field. */
async function openTagFilter(canvas: ReturnType<typeof within>) {
  const field = within(canvas.getByTestId("restock-tag-filter")).getByRole("combobox");
  await userEvent.click(field);
  const first = await screen.findByTestId(`restock-tag-filter-option-${TAG.missing}`, {}, { timeout: 3000 });
  await waitFor(() => expect(first).toBeVisible());
  return field;
}

const rowIds = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll("[data-testid^='restock-row-']")].map((el) => el.getAttribute("data-testid")).sort();

/**
 * CHIPS ON EVERY ROW — a Tags column after the status, two chips and a +N that names the rest on hover; the system's
 * first, locked: 501's admin-made *Audit Gudang*, 503's two problem tags. A custom tag is a plain chip; a restock with
 * none draws nothing. 503 says how many units were missing AND broken.
 */
export const ChipsOnEveryRow: Story = {
  name: "Chips on every row",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = canvas.getByTestId("restock-requests-table");
    await expect(within(table).getByRole("columnheader", { name: "Tags" })).toBeVisible();

    const row501 = within(canvas.getByTestId("restock-tags-501"));
    await expect(row501.getByTestId(`restock-tags-501-${TAG.audit}`)).toHaveAttribute("data-tag-type", "system");
    await expect(row501.getByTestId(`restock-tags-501-${TAG.audit}-lock`)).toBeInTheDocument();
    await expect(row501.getByTestId(`restock-tags-501-${TAG.lebaran}`)).toHaveAttribute("data-tag-type", "custom");
    await expect(row501.queryByTestId(`restock-tags-501-${TAG.lebaran}-lock`)).toBeNull();
    await expect(row501.getByTestId("restock-tags-501-more")).toHaveAttribute("title", "Prioritas");
    await expect(canvas.getByTestId(`restock-tags-502-${TAG.prioritas}`)).toHaveTextContent("Prioritas");

    const chips503 = canvas.getByTestId("restock-tags-503");
    const shown = [...chips503.querySelectorAll("[data-tag-type]")].map((el) => el.textContent);
    await expect(shown).toEqual(["Barang kurang", "Barang rusak"]);
    await expect(canvas.getByTestId(`restock-tags-503-${TAG.missing}-lock`)).toBeInTheDocument();
    await expect(canvas.getByTestId(`restock-tags-503-${TAG.broken}`)).toHaveAttribute("data-tag-type", "system");
    await expect(canvas.getByTestId("restock-tags-503-more")).toHaveTextContent("+1");
    await expect(canvas.getByTestId("restock-tags-503-more")).toHaveAttribute("title", "Retur ke Supplier");

    await expect(canvas.getByTestId("restock-missing-503")).toHaveTextContent("1 missing");
    await expect(canvas.getByTestId("restock-broken-503")).toHaveTextContent("2 broken");
    await expect(canvas.getByTestId("restock-tags-cell-505")).toBeEmptyDOMElement();
  },
};

/**
 * THE PROBLEM LIST — the Tag filter, beside the courier's, picks *Barang kurang*: only the restocks the app tagged for
 * missing units are left, each with its missing and broken counts (a-restock-problem-is-a-system-tag: *"list problem
 * restock — restock listed with missing and broken count"*). *Barang rusak* picked too reads ANY of them — the same two
 * rows, 503 carrying both. The picks are kept in the address (`tag=1,2`) and counted by Clear filters.
 */
const ProblemList = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe hidden /></> }],
  "/inventories/restock",
);

export const TheProblemList: Story = {
  name: "Filter by the problem tags — any of them",
  globals: DESKTOP,
  render: () => <ProblemList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Beside the courier filter, in that order.
    const strip = [...canvasElement.querySelectorAll("[data-testid$='-filter']")].map((el) => el.getAttribute("data-testid"));
    await expect(strip.indexOf("restock-tag-filter")).toBe(strip.indexOf("restock-courier-filter") + 1);

    await openTagFilter(canvas);
    await userEvent.click(screen.getByTestId(`restock-tag-filter-option-${TAG.missing}`));

    await waitFor(() => expect(canvas.queryByTestId("restock-row-501")).toBeNull());
    await expect(rowIds(canvasElement)).toEqual(["restock-row-503", "restock-row-507"]);
    await expect(canvas.getByTestId("restock-missing-503")).toHaveTextContent("1 missing");
    await expect(canvas.getByTestId("restock-broken-503")).toHaveTextContent("2 broken");
    await expect(canvas.getByTestId("restock-missing-507")).toHaveTextContent("3 missing");
    await expect(canvas.queryByTestId("restock-broken-507")).toBeNull();

    // A second pick — the list stays open (several at once) — reads ANY of them: still 503 and 507, never 503 twice.
    await userEvent.click(screen.getByTestId(`restock-tag-filter-option-${TAG.broken}`));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`tag=${TAG.missing}%2C${TAG.broken}`));
    await expect(rowIds(canvasElement)).toEqual(["restock-row-503", "restock-row-507"]);
    await userEvent.keyboard("{Escape}");

    // The picks sit in the field as the chips they are; × takes them all.
    await expect(canvas.getByTestId(`restock-tag-filter-pick-${TAG.missing}`)).toHaveTextContent("Barang kurang");
    await expect(canvas.getByTestId(`restock-tag-filter-pick-${TAG.broken}`)).toHaveTextContent("Barang rusak");
    await expect(canvas.getByTestId("restock-filter-clear")).toBeVisible();

    await userEvent.click(canvas.getByTestId("restock-tag-filter-clear"));
    await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("tag="));
  },
};

/** *Barang rusak* alone, opened from the address: only 503 — 507 was short, never broken. */
const AtBroken = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe hidden /></> }],
  `/inventories/restock?tag=${TAG.broken}`,
);

export const OneTagFromTheAddress: Story = {
  name: "One tag, opened from the address",
  globals: DESKTOP,
  render: () => <AtBroken />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-503", {}, { timeout: 4000 });
    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["restock-row-503"]));
    await expect(await canvas.findByTestId(`restock-tag-filter-pick-${TAG.broken}`)).toHaveTextContent("Barang rusak");
  },
};

/**
 * THE FILTER OFFERS THE APP-WIDE LIST — every team's tags, not only those on this team's rows: Toko Kenanga's *Barang
 * Promo* and *Supplier Baru*, on nobody's restock yet, are there (one list for every team). The system's first, locked;
 * typing narrows it.
 */
export const TheFilterOffersTheAppWideList: Story = {
  name: "The filter offers the app-wide list",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const field = await openTagFilter(canvas);

    const offered = [...document.querySelectorAll("[data-testid^='restock-tag-filter-option-']")].map((el) =>
      el.getAttribute("data-testid")!.replace("restock-tag-filter-option-", ""),
    );
    await expect(offered).toEqual(
      [TAG.audit, TAG.missing, TAG.broken, TAG.promo, TAG.lebaran, TAG.prioritas, TAG.retur, TAG.supplierBaru].map(String),
    );
    await expect(screen.getByTestId(`restock-tag-filter-option-${TAG.missing}`).querySelector("[data-tag-type='system']")).not.toBeNull();

    await userEvent.type(field, "lebaran", { delay: 40 });
    await waitFor(() => expect(screen.queryByTestId(`restock-tag-filter-option-${TAG.prioritas}`)).toBeNull());
    await expect(screen.getByTestId(`restock-tag-filter-option-${TAG.lebaran}`)).toBeVisible();
  },
};

/**
 * A TAG NONE OF OUR RESTOCKS CARRY — opened at `?tag=` Toko Kenanga's *Barang Promo*: nothing matches, the hint says so,
 * and Clear filters takes the tag away with the rest.
 */
const AtPromo = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe hidden /></> }],
  `/inventories/restock?tag=${TAG.promo}`,
);

export const NothingCarriesTheTag: Story = {
  name: "A tag nothing carries — Clear filters",
  globals: DESKTOP,
  render: () => <AtPromo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("restock-requests-empty", {}, { timeout: 4000 });
    await expect(await canvas.findByTestId(`restock-tag-filter-pick-${TAG.promo}`)).toHaveTextContent("Barang Promo");

    await userEvent.click(within(empty).getByRole("button", { name: /clear filters/i }));
    await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("tag="));
  },
};

/**
 * THE STATISTICS AND EKSPOR FOLLOW THE TAGS — the server reads one predicate for the rows, the cards and the file: under
 * the problem tags the census is asked with them, and Ekspor sends them.
 */
const AtProblems = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe hidden /></> }],
  `/inventories/restock?tag=${TAG.missing},${TAG.broken}`,
);

export const TheStatisticsAndExportFollow: Story = {
  name: "The statistics and Ekspor follow the tags",
  globals: DESKTOP,
  render: () => <AtProblems />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-503", {}, { timeout: 4000 });
    await waitFor(() => expect(rowIds(canvasElement)).toEqual(["restock-row-503", "restock-row-507"]));

    await openStatistics(canvas);
    await waitFor(() => expect(restockReadScenario.sellingStatCalls.at(-1)?.filter?.tagIds).toEqual([TAG.missing, TAG.broken]));

    toaster.remove();
    await userEvent.click(canvas.getByTestId("restock-export"));
    await waitFor(() => expect(restockExportScenario.calls).toHaveLength(1));
    await expect(restockExportScenario.calls[0]!.filter?.tagIds).toEqual([TAG.missing, TAG.broken]);
    await expect(restockExportScenario.calls[0]!.rows).toBe(2);
  },
};

/** ON A PHONE — each block carries its tags as a line of chips (they may wrap), the problem counts on its status line. */
export const OnAPhone: Story = {
  name: "Phone — a line of chips in each block",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(390);

    const block = within(canvas.getByTestId("restock-row-503"));
    await expect(block.getByTestId(`restock-tags-503-${TAG.missing}`)).toBeVisible();
    await expect(block.getByTestId(`restock-tags-503-${TAG.retur}`)).toBeVisible();
    await expect(block.getByTestId("restock-broken-503")).toHaveTextContent("2 broken");
    await expect(canvas.queryByTestId("restock-tags-505")).toBeNull();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
