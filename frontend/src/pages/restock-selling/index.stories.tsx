import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockSellingPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// Toko Melati's (12) restock list: 501 ongoing, 502 arrived, 503 accepted, 504 lost, 505 cancelled, 507 accepted with a
// deleted store. Each row's ⋯ offers what its status allows; the Value is goods + shipping, never the courier's
// charge at the door.

const Routed = routedPage(
  [
    { path: "/inventories/restock", element: <RestockSellingPage /> },
    marker("/inventories/restock/new", "at-restock-new"),
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock/:requestId/edit", "at-restock-edit"),
  ],
  "/inventories/restock",
);

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling",
  component: Routed,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
  return canvas;
}

// The items of the row's open menu — portalled, so read off `screen`.
async function menuOf(canvas: ReturnType<typeof within>, id: number): Promise<string[]> {
  await userEvent.click(canvas.getByTestId(`restock-actions-${id}`));
  const [first] = await screen.findAllByRole("menuitem", {}, { timeout: 2000 });
  await waitFor(() => expect(first).toBeVisible());

  return screen.getAllByRole("menuitem").map((item) => item.dataset.testid ?? "");
}

async function closeMenu() {
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryAllByRole("menuitem").filter((el) => el.offsetParent !== null)).toHaveLength(0));
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// A PHONE READS EACH RESTOCK AS A BLOCK (a-phone-reads-each-line-as-a-block) — no headings; the number, its status and
// its ⋯, when and by whom, the supplier, the warehouse, then what is in it beside its value. The filters are a sheet,
// and New Restock is its ＋ (a-phone-filters-from-a-sheet, a-phone-header-action-is-an-icon).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("restock-requests-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const accepted = canvas.getByTestId("restock-row-503");
    await expect(within(accepted).getByTestId("restock-value-503")).toHaveTextContent("Rp 980.000");
    await expect(within(accepted).getByTestId("restock-missing-503")).toHaveTextContent("1 missing");
    await waitFor(() => expect(within(accepted).getByTestId("restock-supplier-503")).toHaveTextContent("PT Sumber Makmur"));
    // FOUR LINES, THE REFERENCE LEADING (a-phone-restock-is-four-lines): the invoice and the tracking number, copyable;
    // the pieces; no store and no SKU — those are the detail page's.
    await expect(within(accepted).getByTestId("restock-invoice-503")).toHaveTextContent("INV/2026/09/0412");
    await expect(within(accepted).getByTestId("restock-receipt-503")).toHaveTextContent("SCP5544332211");
    await expect(accepted).toHaveTextContent("30 pcs");
    await expect(accepted).not.toHaveTextContent("Sumber Makmur Store");
    await expect(accepted).not.toHaveTextContent("SKU-");
    await expect(within(canvas.getByTestId("restock-row-501")).getByTestId("restock-actions-501")).toBeVisible();
    await expect(canvas.getByTestId("open-create-restock")).toHaveAccessibleName("New Restock");

    await userEvent.click(canvas.getByTestId("restock-filter-open"));
    const sheet = await screen.findByTestId("restock-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    for (const id of ["restock-warehouse-filter", "restock-courier-filter", "restock-created-by-filter", "restock-accepted-by-filter"]) {
      await expect(within(sheet).getByTestId(id)).toBeVisible();
    }
  },
};

export const OngoingRowMenu: Story = {
  play: async ({ canvasElement }) => {
    await menuOf(await loaded(canvasElement), 501);
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE SCREEN NAMES ITSELF (the-desktop-shell-has-no-top-bar) and its action carries its icon
// (an-action-button-carries-its-icon); the picked tab is bold (a-selected-tab-is-bold); the pager is on screen even on
// one page (the-pager-is-always-on-screen).
export const TheScreenRules: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Restock" })).toBeVisible();
    await expect(canvas.getByTestId("open-create-restock").querySelector("svg")).not.toBeNull();
    await expect(getComputedStyle(canvas.getByTestId("restock-tab-all")).fontWeight).toBe("700");
    await expect(getComputedStyle(canvas.getByTestId("restock-tab-ongoing")).fontWeight).not.toBe("700");
    await expect(canvas.getByTestId("restock-pager")).toBeVisible();
    // Created: when, and by whom under it — two lines, never three.
    const created = canvas.getByTestId("restock-created-by-501");
    await expect(created).toHaveTextContent("by Ani Rahayu");
    await expect(created.parentElement).toHaveTextContent(/\d{2}:\d{2}by /);
  },
};

// EXPORT AND THE COURIER FILTER ARE ON SCREEN, MARKED (the-restock-list-exports-and-filters-by-courier) — Export beside New
// Restock, its ⚠ on it, and its click says it is not there yet; the courier picked is kept in the URL and counted, so
// Clear takes it back, while the rows do not move for it.
const AtList = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe /></> }],
  "/inventories/restock",
);

export const ExportAndTheCourierFilterAreMarked: Story = {
  render: () => <AtList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    const exporter = canvas.getByTestId("restock-export");
    await expect(within(exporter).getByTestId("not-implemented-export")).toHaveTextContent("1");
    await userEvent.click(exporter);
    // The toast slides in — wait for it to land before reading it.
    const toast = await screen.findByText("Exporting restocks is not available yet.");
    await waitFor(() => expect(toast).toBeVisible());

    const courier = canvas.getByTestId("restock-courier-filter");
    await expect(within(courier).getByTestId("not-implemented-courier")).toHaveTextContent("2");
    await userEvent.click(within(courier).getByRole("combobox"));
    await userEvent.click(await screen.findByTestId("shipment-channel-option-jne"));
    await waitFor(() => expect(location).toHaveTextContent("courier=91"));
    await expect(canvas.getByTestId("restock-filter-clear")).toBeVisible();
    // Held, not asked: the J&T restock is still on the list.
    await expect(canvas.getByTestId("restock-row-502")).toBeVisible();

    await userEvent.click(canvas.getByTestId("restock-filter-clear"));
    await waitFor(() => expect(location).not.toHaveTextContent("courier="));
  },
};

// ── The statistics (the-restock-statistics-count-transactions-under-the-tabs) ─────────────────────────────────────

const digits = (el: HTMLElement) => Number((el.textContent ?? "").replace(/\D/g, ""));

async function openStatistics(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("restock-summary-toggle"));
  return canvas.findByTestId("restock-summary", {}, { timeout: 4000 });
}

// SHUT UNTIL OPENED, UNDER THE TABS — opened on Semua Status, the total and a card per status, each led by how many
// transactions, the units and the value compact under it. Marked sample.
export const TheStatisticsAreShutThenCountTransactions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("restock-summary")).toBeNull();
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();

    const summary = await openStatistics(canvas);
    await expect(within(summary).getByTestId("not-implemented-summary")).toBeInTheDocument();
    const total = within(summary).getByTestId("restock-summary-total");
    await expect(total).toHaveTextContent(/^Total\d+ transactions[\d,]+(rb)? pcs · Rp /);

    // The piles add up to the total.
    let sum = 0;
    for (const key of ["ongoing", "arrived", "accepted", "lost", "cancelled"]) {
      const pile = within(summary).getByTestId(`restock-summary-pile-${key}`);
      sum += Number(/(\d+) transactions?/.exec(pile.textContent ?? "")?.[1]);
    }
    await expect(Number(/(\d+) transactions/.exec(total.textContent ?? "")?.[1])).toBe(sum);
  },
};

// A STATUS TAB DRAWS THAT STATUS'S FIGURES — Transaksi · Jumlah barang · Jumlah SKU · Nilai barang · Ongkir COD · Nilai
// transaksi — and Rincian › opens the value per paying account: the team's two operational accounts, a transfer and an
// e-wallet, adding up to the card.
export const AStatusTabShowsItsFiguresAndPayments: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openStatistics(canvas);

    await userEvent.click(canvas.getByTestId("restock-tab-accepted"));
    const measures = await canvas.findByTestId("restock-summary-measures");
    // The cards are the strip's children — each card's own figure carries a `-value` id of its own.
    const labels = Array.from(measures.children).map((card) => (card as HTMLElement).dataset.testid);
    await expect(labels).toEqual([
      "restock-summary-measure-transactions",
      "restock-summary-measure-units",
      "restock-summary-measure-skus",
      "restock-summary-measure-goods",
      "restock-summary-measure-courier-charge",
      "restock-summary-measure-value",
    ]);
    await expect(within(measures).getByTestId("restock-summary-measure-courier-charge")).toHaveTextContent("Courier COD");

    await userEvent.click(within(measures).getByTestId("restock-summary-payments"));
    const dialog = await screen.findByTestId("restock-payments-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    const rows = await within(dialog).findAllByTestId(/^restock-payment-/);
    await expect(rows.map((row) => row.dataset.testid)).toEqual(["restock-payment-1301", "restock-payment-1303"]);
    await expect(rows[1]).toHaveTextContent("ShopeePay");
    const paid = rows.reduce((s, row) => s + digits(within(row).getByText(/^Rp /)), 0);
    const value = digits(within(within(measures).getByTestId("restock-summary-measure-value")).getByText(/^Rp /));
    await expect(paid).toBe(value);
  },
};

// THE STATISTIK BUTTON ENDS THE TAB ROW on a desktop (the-statistics-button-ends-the-tab-row) — no row of its own; it
// sits level with the tabs, at the row's right end.
export const TheStatisticsButtonEndsTheTabRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const toggle = canvas.getByTestId("restock-summary-toggle");
    const tabs = canvas.getByRole("tablist");

    await expect(toggle).toHaveTextContent("Statistics");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const row = tabs.getBoundingClientRect();
    const button = toggle.getBoundingClientRect();
    // Level with the tabs, and right of the last one.
    await expect(button.top).toBeGreaterThanOrEqual(row.top - 1);
    await expect(button.bottom).toBeLessThanOrEqual(row.bottom + 1);
    await expect(button.left).toBeGreaterThanOrEqual(canvas.getByTestId("restock-tab-cancelled").getBoundingClientRect().right);

    await userEvent.click(toggle);
    await canvas.findByTestId("restock-summary", {}, { timeout: 4000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  },
};

// …on a phone it is an icon beside Filter, in the search row — the six tabs already scroll sideways there. On the
// narrowest phone too: the search gives way, so the icon is never pushed off the screen.
export const OnAPhoneTheStatisticsButtonSitsBesideFilter: Story = {
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const toggle = canvas.getByTestId("restock-summary-toggle");

    await expect(canvas.getByTestId("restock-filter")).toContainElement(toggle);
    await expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await expect(toggle).toHaveAccessibleName("Statistics");
    await expect(canvas.getByRole("tablist")).not.toContainElement(toggle);

    await userEvent.click(toggle);
    await canvas.findByTestId("restock-summary", {}, { timeout: 4000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  },
};

// …on a phone the breakdown is a bottom sheet (a-breakdown-opens-from-rincian).
export const OnAPhoneThePaymentsAreASheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openStatistics(canvas);

    await userEvent.click(canvas.getByTestId("restock-tab-accepted"));
    const measures = await canvas.findByTestId("restock-summary-measures");
    await userEvent.click(within(measures).getByTestId("restock-summary-payments"));
    const sheet = await screen.findByTestId("restock-payments-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
  },
};

// THE OWNER'S COLUMN ORDER (the-restock-list-leads-with-its-references) — the reference first, then the supplier, the
// warehouse, the products, the total, the courier, the status, the two dates and the actions.
export const TheReferenceLeadsTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headings = within(canvas.getByTestId("restock-requests-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());

    await expect(headings).toEqual([
      "Reference",
      "Supplier",
      "Warehouse",
      "Products",
      "Total",
      "Shipment",
      "Status",
      "Created",
      "Accepted",
      "Actions",
    ]);
    // Our own number is not on the row.
    await expect(canvas.getByTestId("restock-row-503")).not.toHaveTextContent("#503");
  },
};

// THE ORDER NUMBER AND THE TRACKING NUMBER ARE COPYABLE, and a long one is cut with its tooltip saying it whole (owner:
// *"order id dan resinya copyable … harus ada pembatasan tapi juga harus ada cara lihat fullnya"*). Copying never opens
// the restock under it.
export const TheReferencesCopyAndALongOneIsCut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 504's tracking number runs long: cut on the row, whole in its tooltip and in what is copied.
    const shown = canvas.getByTestId("restock-receipt-504-shown");
    await expect(shown.scrollWidth).toBeGreaterThan(shown.clientWidth);
    await expect(canvas.getByTestId("restock-receipt-504")).toHaveAccessibleName("Copy: JNE-CGK-20260911-0000111122-REG");
    await userEvent.hover(canvas.getByTestId("restock-receipt-504"));
    const whole = await screen.findByTestId("restock-receipt-504-whole");
    await waitFor(() => expect(whole).toBeVisible());
    await expect(whole).toHaveTextContent("JNE-CGK-20260911-0000111122-REG");
    await userEvent.unhover(canvas.getByTestId("restock-receipt-504"));

    // A short one is shown whole.
    const short = canvas.getByTestId("restock-receipt-503-shown");
    await expect(short.scrollWidth).toBeLessThanOrEqual(short.clientWidth);

    await userEvent.click(canvas.getByTestId("restock-invoice-503"));
    await waitFor(() => {
      const el = canvas.getByTestId("restock-invoice-503");
      expect(el.hasAttribute("data-copied") || el.hasAttribute("data-copy-failed")).toBe(true);
    });
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const ARowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("restock-row-503");
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// NOTHING MATCHES — the empty hint says so and clears the filters (an-empty-list-shows-a-hint); so does the strip's red
// Hapus Filter (clear-filters-is-red-and-bold). The status tab is not a filter, and stays.
const AtNoMatch = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe /></> }],
  "/inventories/restock?status=ongoing&q=nothing-is-called-this",
);

export const NothingMatchesClearsTheFilters: Story = {
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("restock-requests-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No restocks match.");
    await expect(canvas.getByTestId("restock-filter-clear")).toBeVisible();
    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));

    await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("restock-search")).toHaveValue("");
    await expect(canvas.getByTestId("restock-tab-ongoing")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.queryByTestId("restock-filter-clear")).toBeNull();
  },
};

// Five statuses, five tabs, plus All (statusTabs.ts).
export const FiveStatusTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const tab of ["all", "ongoing", "arrived", "accepted", "lost", "cancelled"]) {
      await expect(canvas.getByTestId(`restock-tab-${tab}`)).toBeVisible();
    }
  },
};

// the-warehouse-signs-and-accepts-the-team-does-the-rest — the row menu follows the status: ongoing Edit · Cancel ·
// Mark Lost; arrived Edit Lines only; accepted, lost and cancelled have no menu at all.
export const TheRowMenuFollowsTheStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await menuOf(canvas, 501)).toEqual([
      "restock-action-edit-501",
      "restock-action-cancel-501",
      "restock-action-mark-lost-501",
    ]);
    await closeMenu();

    await expect(await menuOf(canvas, 502)).toEqual(["restock-action-edit-lines-502"]);
    await closeMenu();

    for (const id of [503, 504, 505, 507]) {
      await expect(canvas.queryByTestId(`restock-actions-${id}`)).toBeNull();
    }
  },
};

// Edit Lines opens the same edit form — the form applies the arrived rules.
export const EditLinesOpensTheEditForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 502);
    await userEvent.click(screen.getByTestId("restock-action-edit-lines-502"));
    await expect(await canvas.findByTestId("at-restock-edit")).toBeInTheDocument();
  },
};

// a-restock-names-its-paying-account — cancelling from the row asks the money question too, and the row moves to
// cancelled.
export const CancelFromTheRowAsksAboutTheMoney: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-cancel-501"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    // It warns that a cancellation is checked (a-restock-cancel-warns-it-will-be-checked).
    const review = screen.getByTestId("restock-cancel-review");
    await expect(review).toHaveTextContent("Cancelling a restock will be checked.");
    // …and nothing checks it yet: marked, the list's fifth.
    await expect(within(review).getByTestId("not-implemented-cancelReview")).toHaveTextContent("5");
    await expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByTestId("restock-cancel-money-no"));
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.CANCELLED}`)).toBeVisible());
    await expect(canvas.queryByTestId("restock-actions-501")).toBeNull();
    // The dialog did not navigate the row behind it.
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// lost-is-set-only-before-the-box-arrives — Mark Lost from the row.
export const MarkLostFromTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-mark-lost-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.LOST}`)).toBeVisible());
  },
};

// the-couriers-charge-stays-out-of-total — 503's Value is goods 950.000 + shipping 30.000, not the 5.000 the courier
// asked at the door.
export const TheValueIsGoodsPlusShipping: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-value-503")).toHaveTextContent("Rp 980.000");
    await expect(canvas.getByTestId("restock-value-501")).toHaveTextContent("Rp 2.080.000");
  },
};

// a-short-unit-at-the-door-is-missing — an accepted row with units short says MISSING.
export const MissingUnitsAreFlagged: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-missing-503")).toHaveTextContent("1 missing");
    await expect(canvas.queryByTestId("restock-missing-501")).toBeNull();
  },
};

// The supplier is read off the lines, and a deleted store still shows, badged (a-deleted-supplier-still-shows-with-a-
// badge). The invoice and the tracking number are labelled.
export const SupplierInvoiceAndCourier: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("restock-supplier-503")).toHaveTextContent("PT Sumber Makmur"));
    await waitFor(() => expect(within(canvas.getByTestId("restock-supplier-507")).getByTestId("deleted-badge")).toBeVisible());
    // 501's lines name two suppliers — the first, and "+1 more".
    await expect(canvas.getByTestId("restock-supplier-501")).toHaveTextContent("+1 more supplier");
    await expect(canvas.getByTestId("restock-invoice-503")).toHaveTextContent("INV/2026/09/0412");
    await expect(canvas.getByTestId("restock-receipt-503")).toHaveTextContent("SCP5544332211");
  },
};

// The Arrived tab is a real filter — the box at the door, waiting for the warehouse to count it.
export const TheArrivedTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-tab-arrived"));
    await waitFor(() => expect(canvas.queryByTestId("restock-row-501")).toBeNull());
    await expect(canvas.getByTestId("restock-row-502")).toBeVisible();
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the tab and the search are its; a
// change is written back.
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe /></> }],
  "/inventories/restock?status=arrived&q=JNT",
);

export const FiltersLiveInTheUrl: Story = {
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-502", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId("restock-search")).toHaveValue("JNT");
    await expect(canvas.getByTestId("restock-tab-arrived")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.queryByTestId("restock-row-501")).toBeNull();

    await userEvent.click(canvas.getByTestId("restock-tab-accepted"));
    await waitFor(() => expect(location).toHaveTextContent("status=accepted"));
    await expect(location).toHaveTextContent("q=JNT");
  },
};
