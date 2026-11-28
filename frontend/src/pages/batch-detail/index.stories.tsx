import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { useLocation, useParams } from "react-router-dom";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { productLeftItsRacksForStory, productPlacesForStory } from "../../../.storybook/batchStub";
import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { type HeldRpc, callsOf, holdRpc } from "../../../.storybook/holdRpc";
import { inventoryClient, productClient, supplierClient, teamClient, userClient } from "../../api/clients";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { cameFrom } from "../../lib/cameFrom";
import { BatchDetailPage } from "./index";

// ONE BATCH — Gudang Pusat's (11), read by its crew (batchStub.ts). 5031 is restock 503's Beras: 10 arrived, 2 broken,
// 1 missing, 7 ready, put on A-01-1 (5) and B-02-1 (2), expiring in 20 days. 9101 is a return of Kopi — order 106's.
// 5071 is Teh, all used.

/** An order's warehouse page, saying which order and where it was opened from (its Back). */
function AtWarehouseOrder() {
  const { orderId } = useParams();
  const from = cameFrom(useLocation());

  return (
    <Text data-testid="at-warehouse-order" data-order-id={orderId} data-from={from ?? ""}>
      at-warehouse-order
    </Text>
  );
}

function routes() {
  return [
    { path: "/inventories/batches/:batchId", element: <BatchDetailPage /> },
    marker("/inventories/batches", "at-batch-list"),
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    { path: "/warehouse-orders/:orderId", element: <AtWarehouseOrder /> },
  ];
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const At5031 = routedPage(routes(), "/inventories/batches/5031");
const At9101 = routedPage(routes(), "/inventories/batches/9101");
const At5032 = routedPage(routes(), "/inventories/batches/5032");
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

    // SIAP LEADS, AND EVERY FIGURE SAYS WHAT IT COUNTS (ready-leads-and-each-figure-says-what-it-counts).
    const cards = [...canvas.getByTestId("batch-detail-lifecycle").querySelectorAll<HTMLElement>('[data-testid$="-card"]')];
    await expect(cards.map((el) => el.dataset.testid)).toEqual([
      "batch-detail-ready-card",
      "batch-detail-arrived-card",
      "batch-detail-broken-card",
      "batch-detail-lost-card",
      "batch-detail-used-card",
    ]);
    // WHAT IT IS WORTH, UNDER THE COUNT (tiba-keeps-its-date-in-info) — the Rp the small line under each count, as it
    // always was; Tiba's date is Info's *Arrived at* now, not after its Rp.
    await expect(canvas.getByTestId("batch-detail-ready-amount")).toHaveTextContent(/^Rp/);
    await expect(canvas.getByTestId("batch-detail-ready-amount").getBoundingClientRect().top).toBeGreaterThanOrEqual(
      canvas.getByTestId("batch-detail-ready-card-value").getBoundingClientRect().bottom - 1,
    );
    await expect(canvas.getByTestId("batch-detail-arrived-amount")).toHaveTextContent(/^Rp [\d.]+$/);
    await expect(canvas.getByTestId("batch-detail-arrived-card")).not.toHaveTextContent(/\d{1,2} \w{3} \d{2}:\d{2}/);
    await expect(canvas.getByTestId("batch-info-panel")).toHaveTextContent("Arrived at");
    await expect(canvas.getByTestId("batch-detail-arrived-date")).toHaveTextContent(/\d{1,2} \w{3} \d{2}:\d{2}/);

    // The owner's words for each (*"Siap, stok di rak, bisa untuk transaksi …"*), two lines where a fifth of the row cuts one.
    await expect(canvas.getByTestId("batch-detail-ready-card-note")).toHaveTextContent("Stock on the shelf, available for transactions");
    await expect(canvas.getByTestId("batch-detail-arrived-card-note")).toHaveTextContent("Stock received in this batch");
    await expect(canvas.getByTestId("batch-detail-broken-card-note")).toHaveTextContent("Stock that was damaged");
    await expect(canvas.getByTestId("batch-detail-lost-card-note")).toHaveTextContent("Stock that never arrived or was lost");
    await expect(canvas.getByTestId("batch-detail-used-card-note")).toHaveTextContent(/^Stock already transacted$/);

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
    // Penempatan's last count is one word over its badge on a phone.
    await expect(canvas.getByTestId("batch-detail-opname-header")).toHaveTextContent(/^Opname$/);

    // RIWAYAT'S TWO FILTERS OPEN AS DRAWERS FROM THE BOTTOM on a phone (a-phone-filter-opens-from-the-bottom): Kegiatan is a
    // button over a sheet, not a field to type into; the date's panel is a dialog at the screen's foot.
    await expect(canvas.getByTestId("batch-detail-kind").tagName).toBe("BUTTON");
    await userEvent.click(canvas.getByTestId("batch-detail-date"));
    const datePanel = await screen.findByTestId("batch-detail-date-panel");
    await waitFor(() => expect(datePanel).toBeVisible());
    await expect(datePanel).toHaveAttribute("role", "dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("batch-detail-date-panel")).toBeNull());

    // RIWAYAT'S BLOCK LEADS WITH THE RACK (riwayat-on-a-phone-leads-with-the-rack) — its code in bold and its name on top,
    // the kind's badge and the day under them.
    const block = (
      await within(canvas.getByTestId("batch-history-panel")).findAllByTestId(/^batch-detail-history-row-\d+$/, {}, { timeout: 4000 })
    )[0]!;
    const place = within(block).getByTestId(/-place$/);
    await expect(place).toHaveTextContent(/^[AB]-0\d-1 · Aisle [AB] bawah$/);
    await expect(getComputedStyle(place.firstElementChild as HTMLElement).fontWeight).toBe("700");
    const kind = within(block).getByTestId(/-kind$/);
    await expect(kind).toHaveTextContent("Received");
    await expect(kind.getBoundingClientRect().top).toBeGreaterThan(place.getBoundingClientRect().bottom - 1);

    // NO SECTION NAV ON A PHONE — neither chips nor the column; the title bar alone sticks, at the very top
    // (the-phone-batch-page-has-no-section-chips).
    await expect(canvas.queryByTestId("section-nav-strip")).toBeNull();
    await expect(canvas.queryByTestId("section-nav")).toBeNull();
    window.scrollTo(0, 600);
    const bar = canvas.getByTestId("batch-detail-name-bar");
    await waitFor(() => expect(bar).toHaveAttribute("data-shown", "true"));
    await expect(Math.round(bar.getBoundingClientRect().top)).toBe(0);
    window.scrollTo(0, 0);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    // Info is the lowest priority, so on a narrow screen it is the LAST section, under Riwayat (info-batch-comes-last).
    const history = canvas.getByTestId("batch-history-panel");
    const info = canvas.getByTestId("batch-info-panel");
    await expect(history.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    // Info is the lowest priority, so it is last (info-batch-comes-last).
    await expect([...nav.querySelectorAll<HTMLElement>("[data-section]")].map((el) => el.dataset.section)).toEqual([
      "placements",
      "history",
      "info",
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
    // The expiry — the day at the size of the facts above it, and how long is left a BADGE, amber within 30 days
    // (an-expiry-says-how-long-is-left, the-expiry-left-is-a-badge).
    const expiry = within(info).getByTestId("batch-detail-expiry");
    const cost = within(info).getByTestId("batch-detail-unit-cost");
    await expect(getComputedStyle(expiry).fontSize).toBe(getComputedStyle(cost).fontSize);
    const left = within(info).getByTestId("batch-detail-expiry-left");
    await expect(left).toHaveAttribute("data-band", "soon");
    await expect(left.className).toMatch(/badge/);

    // The page arrives in order (the-batch-page-arrives-in-order) — the heading, the figures, Penempatan with Info beside
    // it, then Riwayat, 50ms apart; the root rises no more. The run asks for reduced motion, so the delay is read, not seen.
    // Info arrives with Penempatan where it sits beside it, and last where it is the last card.
    const delay = (part: string) => getComputedStyle(canvas.getByTestId(`batch-detail-enter-${part}`)).animationDelay;
    await expect(["heading", "figures", "placements", "history"].map(delay)).toEqual(["0s", "0.05s", "0.1s", "0.15s"]);
    await expect(["0.1s", "0.2s"]).toContain(delay("info"));
    await expect(getComputedStyle(canvas.getByTestId("batch-detail-enter-heading")).animationFillMode).toBe("backwards");

    // A pager with nothing to do steps aside (the-batch-page-hides-a-pager-that-fits) — 5031 sits on 2 racks and has 2
    // movements, under the smallest page size, 10.
    await waitFor(() => expect(canvas.getByTestId("batch-detail-shelf-41")).toBeInTheDocument());
    await waitFor(() => expect(canvas.getAllByTestId(/^batch-detail-history-row-\d+$/)).toHaveLength(2));
    await expect(canvas.queryByTestId("batch-detail-placements-pager")).toBeNull();
    await expect(canvas.queryByTestId("batch-detail-history-pager")).toBeNull();
    // …and with no pager under them, the tables end bare — no line under the last row (owner: *"tabel yang tidak ada
    // paginasi, border line paling bawah tidak perlu ada"*).
    for (const table of ["batch-detail-placements-table", "batch-detail-history-table"]) {
      const rows = canvas.getByTestId(table).querySelectorAll("tbody tr");
      const last = rows[rows.length - 1]!.querySelector("td")!;
      const first = rows[0]!.querySelector("td")!;
      await expect(getComputedStyle(last).borderBottomWidth).toBe("0px");
      // Only the last — the rows above keep the line between them.
      await expect(getComputedStyle(first).borderBottomWidth).not.toBe("0px");
    }

    // A nav click jumps there and lights it (a-nav-jump-blinks-where-it-lands). Given the file's long wait: under a full
    // run's load the jump and the spy's next frame took past the default second, and the story read red.
    await userEvent.click(canvas.getByTestId("section-nav-history"));
    await waitFor(
      () => expect(canvas.getByTestId("section-nav-history")).toHaveAttribute("aria-current", "location"),
      { timeout: 4000 },
    );
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

// PENEMPATAN (placement-is-one-word-its-meaning-a-line, a-placement-names-its-rack) — one word for a title and what it
// means as the line under it; each rack its code with its name under it, found by either; the search the section's width.
export const ThePlacement: Story = {
  name: "Placement",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const panel = canvas.getByTestId("batch-placements-panel");

    await expect(within(panel).getByRole("heading", { name: "Placement" })).toBeInTheDocument();
    await expect(canvas.getByTestId("batch-placements-panel-description")).toHaveTextContent(
      "The racks this batch was put on when it was accepted.",
    );
    await expect(canvas.getByTestId("section-nav-placements")).toHaveTextContent("Placement");

    await waitFor(() => expect(canvas.getByTestId("batch-detail-shelf-name-41")).toHaveTextContent("Aisle A bawah"));
    await expect(canvas.getByTestId("batch-detail-shelf-place-41")).toHaveTextContent("A-01-1");

    // THE LAST COUNT IS A BADGE (last-count-is-a-badge) — A-01-1 counted 3 days ago (success), B-02-1 30 days ago, past the
    // two weeks (warning); the colour is the state, the date its words, the whole date its hover.
    const fresh = canvas.getByTestId("batch-detail-shelf-opname-41");
    await expect(fresh).toHaveAttribute("data-state", "fresh");
    await expect(fresh).toHaveTextContent(/^\d{1,2} \w{3}$/);
    await expect(fresh).toHaveAttribute("title");
    await expect(canvas.getByTestId("batch-detail-shelf-opname-43")).toHaveAttribute("data-state", "overdue");

    // The search spans the section — at a field's own height, never stretched down — and finds a rack by its name too.
    const search = canvas.getByTestId("batch-detail-rack-search");
    await expect(search.getBoundingClientRect().width).toBeGreaterThan(panel.getBoundingClientRect().width * 0.8);
    // The group around the input is what a column's flex stretched — it is the one measured.
    await expect(search.parentElement!.getBoundingClientRect().height).toBeLessThan(48);
    await userEvent.type(search, "aisle b", { delay: 20 });
    await waitFor(() => expect(canvas.queryByTestId("batch-detail-shelf-41")).toBeNull());
    await expect(canvas.getByTestId("batch-detail-shelf-43")).toBeInTheDocument();
  },
};

// A RACK NEVER COUNTED (last-count-is-a-badge) — 5032, Teh on A-01-2: *Never* in grey, one word where a sentence was.
export const NeverCounted: Story = {
  name: "Never counted",
  render: () => <At5032 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const badge = await canvas.findByTestId("batch-detail-shelf-opname-42", {}, { timeout: 4000 });

    await expect(badge).toHaveAttribute("data-state", "never");
    await expect(badge).toHaveTextContent(/^Never$/);
  },
};

// THE PRODUCT IS ONE FULL-WIDTH CARD (the-batch-product-is-one-full-card) — its picture, name, code and owner, as wide as
// the figures under it; and no *What is a batch?* on a batch's own page (what-a-batch-is-said-on-the-list-only).
export const TheProductIsOneCard: Story = {
  name: "Product card",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const card = canvas.getByTestId("batch-detail-product-card");

    await expect(card).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(within(card).getByTestId("product-list-item-sku-74")).toHaveTextContent("SKU-BERAS-5K");
    await waitFor(() => expect(within(card).getByTestId("batch-detail-owner")).toHaveTextContent("Toko Melati"));
    await expect(within(card).getByTestId("batch-detail-owner")).toHaveTextContent("Owner");
    // As wide as the figures' strip — a card the row's width, not a line floating under the title.
    const strip = canvas.getByTestId("batch-detail-lifecycle");
    await expect(Math.round(card.getBoundingClientRect().width)).toBe(Math.round(strip.getBoundingClientRect().width));

    await expect(canvas.queryByTestId("batch-explainer-toggle")).toBeNull();

    // A SMALL PICTURE OPENS BIG (a-small-picture-opens-its-preview) — the cover, titled with the product, its code under
    // it. Toko Melati has no picture, only initials: nothing to open, so no button.
    await expect(within(card).queryByTestId("team-item-image-12")).toBeNull();
    await userEvent.click(within(card).getByTestId("product-list-item-image-74"));
    const preview = await screen.findByTestId("image-preview");
    await waitFor(() => expect(preview).toBeVisible());
    await expect(preview).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(preview).toHaveTextContent("SKU-BERAS-5K");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("image-preview")).toBeNull());
  },
};

// ITS HISTORY — the put-away on each rack, at the accept; the reworked ledger. A line under the title saying what it
// holds, the date filter the section's width, each kind a badge in its colour and each rack named (riwayat-reads-as-penempatan).
export const History: Story = {
  name: "History",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const panel = canvas.getByTestId("batch-history-panel");

    // On the page — no tab to open first.
    const table = await within(panel).findByTestId("batch-detail-history-table", {}, { timeout: 4000 });
    await expect(table).toHaveTextContent("A-01-1");
    await expect(table).toHaveTextContent("B-02-1");

    await expect(canvas.getByTestId("batch-history-panel-description")).toHaveTextContent(
      "Every movement of this batch's stock, from its arrival to its leaving.",
    );
    // The two filters span the section together — the date and Kegiatan beside it, narrower (riwayat-filters-by-one-kind).
    const filters = canvas.getByTestId("batch-detail-history-filters");
    await expect(filters.getBoundingClientRect().width).toBeGreaterThan(panel.getBoundingClientRect().width * 0.8);
    const date = canvas.getByTestId("batch-detail-date").getBoundingClientRect();
    const kindFilter = canvas.getByTestId("batch-detail-kind");
    await expect(kindFilter.getBoundingClientRect().left).toBeGreaterThan(date.right);
    await expect(kindFilter.getBoundingClientRect().width).toBeLessThan(date.width);
    await expect(kindFilter).toHaveAttribute("placeholder", "All activities");

    // The date's × — on screen once a window is set, back to every date in one click.
    await expect(canvas.queryByTestId("batch-detail-date-reset")).toBeNull();
    await userEvent.click(canvas.getByTestId("batch-detail-date"));
    await userEvent.click(await screen.findByTestId("batch-detail-date-quick-7"));
    await waitFor(() => expect(canvas.getByTestId("batch-detail-date")).toHaveTextContent("Last 7 days"));
    await userEvent.click(canvas.getByTestId("batch-detail-date-reset"));
    await waitFor(() => expect(canvas.getByTestId("batch-detail-date")).toHaveTextContent("All dates"));
    await expect(canvas.queryByTestId("batch-detail-date-reset")).toBeNull();

    // Each kind a badge in its colour — a put-away is stock IN, green.
    const kinds = table.querySelectorAll<HTMLElement>('[data-testid$="-kind"]');
    await expect(kinds.length).toBeGreaterThan(0);
    const received = [...kinds].find((el) => el.textContent === "Received")!;
    await expect(received.className).toMatch(/badge/);

    // Each rack named under its code.
    await expect(within(table).getAllByText("Aisle A bawah").length).toBeGreaterThan(0);

    // ONE KIND AT A TIME, read from the server — 5031 was put away and nothing has been picked from it: Picked is empty,
    // Received its two put-away rows.
    const pick = async (kind: MovementKind) => {
      await userEvent.click(kindFilter);
      const option = await screen.findByTestId(`batch-detail-kind-${kind}`);
      await waitFor(() => expect(option).toBeVisible());
      await userEvent.click(option);
    };
    await pick(MovementKind.PICK);
    await waitFor(() => expect(kindFilter).toHaveValue("Picked"));
    await expect(await within(panel).findByTestId("batch-detail-history-empty", {}, { timeout: 4000 })).toBeVisible();
    await pick(MovementKind.RECEIVE);
    await waitFor(() =>
      expect(within(panel).getAllByTestId(/^batch-detail-history-row-\d+$/)).toHaveLength(2),
    );
    // Its × — every kind again.
    await userEvent.click(canvas.getByTestId("batch-detail-kind-clear"));
    await waitFor(() => expect(kindFilter).toHaveValue(""));
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

// A RETURN — its origin says so, there is no restock to open, and Info's *Dari* names the order whose return it is
// (a-returns-batch-opens-its-order) — nothing marked unbuilt any more.
export const AReturn: Story = {
  name: "A return",
  render: () => <At9101 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("batch-detail-origin")).toHaveTextContent("Return");
    await expect(canvas.queryByTestId("batch-detail-order")).toBeNull();
    await expect(canvas.getByTestId("batch-detail-return")).toHaveTextContent(/^Return · order #106$/);
    await expect(canvas.queryByTestId("not-implemented-returnLink")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(canvas.queryByTestId("batch-detail-expiring")).toBeNull();
  },
};

// A RETURN'S BATCH OPENS ITS ORDER — *Return · order #106* opens /warehouse-orders/106, the order's warehouse page where
// the return was accepted, carrying this batch's page so Back returns here.
export const OpensItsReturnsOrder: Story = {
  name: "Opens its return's order",
  render: () => <At9101 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("batch-detail-return"));

    const at = await canvas.findByTestId("at-warehouse-order");
    await expect(at).toHaveAttribute("data-order-id", "106");
    await expect(at).toHaveAttribute("data-from", "/inventories/batches/9101");
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

// THE PRODUCT'S RACKS ARE READ ONCE (#133, the-speed-audits-old-findings-are-fixed-smallest-first) — the page's own
// ProductPlaces names its shelves and gives the Adjust dialog each rack's figure; the dialog, mounted closed beside the
// page, read the same ProductPlaces again on every load.
export const TheRacksAreReadOnce: Story = {
  name: "Racks read once",
  beforeEach: () => {
    // Beras (74) holds 5 on A-01-1 and 2 on B-02-1 now.
    productPlacesForStory({ "74": [[41n, 5n], [43n, 2n]] });
    const spy = spyOn(inventoryClient, "productPlaces");

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("batch-detail-shelf-41")).toHaveTextContent("A-01-1"));

    await userEvent.click(canvas.getByTestId("batch-detail-adjust"));
    await waitFor(() => expect(screen.getByTestId("adjust-dialog")).toBeVisible());

    // At the top, the product's units here — 5 + 2 across its racks — and THIS batch with its own left
    // (the-adjust-dialog-leads-with-what-it-adjusts, the-batch-page-adjusts-its-own-batch).
    await expect(screen.getByTestId("adjust-available")).toHaveTextContent("7 units");
    const fixed = screen.getByTestId("adjust-batch-fixed");
    await expect(fixed).toHaveTextContent("Batch #5031");
    await expect(fixed).toHaveTextContent("Restock #503");
    await expect(screen.getByTestId("adjust-batch-left")).toHaveTextContent("7 units");

    // Only the racks 5031 was put on — A-01-1 and B-02-1, not A-01-2.
    const trigger = screen.getByTestId("rack-select");
    const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
    await userEvent.click(trigger);
    await waitFor(() => expect(within(root).getByTestId("rack-select-option-41")).toBeVisible(), { timeout: 5000 });
    await expect(within(root).getByTestId("rack-select-option-43")).toBeInTheDocument();
    await expect(within(root).queryByTestId("rack-select-option-42")).toBeNull();

    // A-01-1 reads the page's figure: a recount to 3 is 5 before, down 2, 3 in total.
    await userEvent.click(within(root).getByTestId("rack-select-option-41"));
    await userEvent.clear(screen.getByTestId("adjust-amount"));
    await userEvent.type(screen.getByTestId("adjust-amount"), "3", { delay: 40 });
    await waitFor(() => expect(screen.getByTestId("adjust-delta-before")).toHaveTextContent(/^5$/));
    await expect(screen.getByTestId("adjust-delta-diff")).toHaveTextContent(/^Decreased\s*−2$/);
    await expect(screen.getByTestId("adjust-delta-total")).toHaveTextContent(/^3$/);

    await expect((inventoryClient.productPlaces as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);

    // Rusak takes THIS batch — nothing opens to pick one.
    await userEvent.click(screen.getByTestId("adjust-reason-option-damaged"));
    await expect(screen.queryByTestId("adjust-batch")).toBeNull();
  },
};

// THE BATCH'S READS GO OUT SIDE BY SIDE (#134, the-speed-audits-old-findings-are-fixed-smallest-first) — once the batch
// itself has answered, where its product sits, its product and owner, its supplier, who accepted it and Riwayat are asked
// together: none of them needs another's answer. They ran one after another — seven round trips. The page still draws
// once ALL of it is in, never by halves.
let shelvesHeld: HeldRpc | undefined;

export const ItsReadsGoOutSideBySide: Story = {
  name: "Reads side by side",
  beforeEach: () => {
    // Where the product sits answers late — the reads that used to queue behind it go out meanwhile.
    shelvesHeld = holdRpc(inventoryClient, "productPlaces");
    const spies = [
      spyOn(inventoryClient, "stockHistory"),
      spyOn(productClient, "productByIds"),
      spyOn(teamClient, "teamByIds"),
      spyOn(supplierClient, "supplierByIds"),
      spyOn(userClient, "userByIDs"),
    ];

    return () => {
      shelvesHeld?.restore();
      for (const spy of spies) spy.mockRestore();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Held: the shelves. Asked all the same — Riwayat (the batch's product is all it needs), the product and its owner,
    // the supplier, who accepted it.
    await waitFor(
      () => {
        expect(callsOf(inventoryClient.stockHistory).length).toBeGreaterThan(0);
        expect(callsOf(productClient.productByIds).length).toBeGreaterThan(0);
        expect(callsOf(teamClient.teamByIds).length).toBeGreaterThan(0);
        expect(callsOf(supplierClient.supplierByIds).length).toBeGreaterThan(0);
        expect(callsOf(userClient.userByIDs).length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    // ...and the page is not drawn by halves: still its first load's shape.
    await expect(canvas.getByTestId("batch-detail-loading")).toBeVisible();
    await expect(canvas.queryByTestId("batch-detail-page")).toBeNull();

    shelvesHeld?.release();
    const page = await loaded(canvasElement);

    // All of it at once: whose goods, the shelves by their codes.
    await expect(page.getByTestId("batch-detail-owner")).toHaveTextContent("Toko Melati");
    await waitFor(() => expect(page.getByTestId("batch-detail-shelf-41")).toHaveTextContent("A-01-1"), { timeout: 5000 });
  },
};
