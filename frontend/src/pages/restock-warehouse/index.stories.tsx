import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockWarehousePage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// Gudang Pusat's (11) inbound queue, read by its floor crew (WAREHOUSE_STAFF). It opens on the last 7 days, so the rows
// are 501 (ongoing, Toko Melati), 502 (arrived) and 506 (ongoing, Toko Kenanga); the headline counts every restock
// still on its way or at the door, whatever the window.

const Routed = routedPage(
  [
    { path: "/inventories/restock", element: <RestockWarehousePage /> },
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock/:requestId/accept", "at-restock-accept"),
  ],
  "/inventories/restock",
);

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouse",
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
  await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
  return canvas;
}

function actionsOf(row: HTMLElement): string[] {
  return [...row.querySelectorAll<HTMLElement>("[data-testid^='restock-action-']")].map((el) => el.dataset.testid ?? "");
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// A PHONE READS EACH RESTOCK AS A BLOCK (a-phone-reads-each-line-as-a-block, every-page-has-a-mobile-story) — no headings;
// the number, its status and when; from whom; the courier and the tracking number; what is in it; the acts at the door,
// named. The filters are a sheet (a-phone-filters-from-a-sheet), and nothing runs past the screen's edge.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("restock-inbound-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const row = canvas.getByTestId("restock-row-501");
    await expect(row).toHaveTextContent("Toko Melati");
    await expect(within(row).getByTestId("restock-receipt-501")).toHaveTextContent("JNE0123456789");
    await expect(within(row).getByTestId("restock-action-sign-501")).toBeVisible();
    await expect(within(row).getByTestId("restock-action-accept-501")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await userEvent.click(canvas.getByTestId("restock-inbound-filter-open"));
    const sheet = await screen.findByTestId("restock-inbound-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    for (const id of ["restock-inbound-from", "restock-inbound-person"]) {
      await expect(within(sheet).getByTestId(id)).toBeVisible();
    }
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE SCREEN RULES (the-warehouse-restock-list-follows-the-screen-rules) — the page names itself
// (the-desktop-shell-has-no-top-bar); the queue's figures are the card strip, the count leading
// (a-list-summary-is-the-order-lists-card-strip); the picked tab is bold (a-selected-tab-is-bold); a row's date is short,
// with its time (a-table-date-is-short-and-every-time-is-wib); the pager is on screen on one page
// (the-pager-is-always-on-screen).
export const TheScreenRules: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Incoming Restocks" })).toBeVisible();
    await expect(canvas.getByTestId("restock-inbound-summary")).toBeVisible();
    await expect(canvas.getByTestId("restock-stat-restocks")).toHaveAttribute("data-emphasis", "true");
    await expect(getComputedStyle(canvas.getByTestId("restock-tab-all")).fontWeight).toBe("700");
    await expect(canvas.getByTestId("restock-inbound-pager")).toBeVisible();
  },
};

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`.
export const ARowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("restock-row-501");
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
  [{ path: "/inventories/restock", element: <><RestockWarehousePage /><LocationProbe /></> }],
  "/inventories/restock?status=ongoing&q=nothing-is-called-this",
);

export const NothingMatchesClearsTheFilters: Story = {
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("restock-inbound-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No restocks match.");
    await expect(canvas.getByTestId("restock-inbound-filter-clear")).toBeVisible();
    await userEvent.click(within(empty).getByRole("button", { name: "Clear Filters" }));

    await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("restock-inbound-search")).toHaveValue("");
    await expect(canvas.getByTestId("restock-tab-ongoing")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.queryByTestId("restock-inbound-filter-clear")).toBeNull();
  },
};

export const FiveStatusTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const tab of ["all", "ongoing", "arrived", "accepted", "lost", "cancelled"]) {
      await expect(canvas.getByTestId(`restock-tab-${tab}`)).toBeVisible();
    }
  },
};

// the-warehouse-signs-and-accepts-the-team-does-the-rest — ongoing rows offer Sign for Box and Accept; the arrived one
// Accept only. Never Edit, Cancel or Mark Lost — those are the selling team's.
export const TheRowActionsFollowTheStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(actionsOf(canvas.getByTestId("restock-row-501"))).toEqual([
      "restock-action-sign-501",
      "restock-action-accept-501",
    ]);
    await expect(actionsOf(canvas.getByTestId("restock-row-502"))).toEqual(["restock-action-accept-502"]);
    await expect(actionsOf(canvas.getByTestId("restock-row-506"))).toEqual([
      "restock-action-sign-506",
      "restock-action-accept-506",
    ]);
  },
};

// Signing for the box confirms, and the row moves to arrived — leaving Accept.
export const SignForBoxFromTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeVisible());
    await waitFor(() => expect(actionsOf(row)).toEqual(["restock-action-accept-501"]));
    // The dialog did not navigate the row behind it.
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// THE COURIER'S CHARGE IN THE ROW'S SIGN DIALOG IS NOT KEPT YET (the-cod-can-be-noted-when-the-box-arrives) — its mark is
// this page's second, after the COD card's.
export const TheSignDialogMarksItsCourierCharge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const charge = await screen.findByTestId("sign-courier");
    await waitFor(() => expect(charge).toBeVisible());
    await expect(within(charge).getByTestId("not-implemented-arrivalCod")).toHaveTextContent("2");
  },
};

// Accept opens the accept PAGE — counting, placing and pricing is a form with sections.
export const AcceptOpensTheAcceptPage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-accept-502"));
    await expect(await canvas.findByTestId("at-restock-accept")).toBeInTheDocument();
  },
};

// The headline is the queue still to do — ongoing AND arrived — over every restock to this warehouse, not the page.
export const TheHeadlineCountsOngoingAndArrived: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 501 and 506 ongoing, 502 arrived — 504 is lost and 503/507 accepted, so they are not waiting.
    await waitFor(() => expect(canvas.getByTestId("restock-stat-restocks")).toHaveTextContent("3"));
  },
};

// The courier is a shipment channel, named.
export const TheCourierIsNamed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId("shipment-channel-badge-jne")).toHaveTextContent("JNE"));
    await expect(row).toHaveTextContent("JNE0123456789");
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the tab and the person's role are
// its; a change is written back. The 7-day window is the default, so it is not in the URL at all.
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/restock", element: <><RestockWarehousePage /><LocationProbe /></> }],
  "/inventories/restock?status=arrived&role=accepted",
);

export const FiltersLiveInTheUrl: Story = {
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-502", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId("restock-tab-arrived")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByTestId("restock-inbound-actor-role")).toHaveTextContent("Counted by");
    await expect(canvas.queryByTestId("restock-row-501")).toBeNull();

    await userEvent.click(canvas.getByTestId("restock-tab-ongoing"));
    await waitFor(() => expect(location).toHaveTextContent("status=ongoing"));
    await expect(location).toHaveTextContent("role=accepted");
    await expect(location).not.toHaveTextContent("range=");
  },
};

// WHO AND WHEN (owner: *"tablenya dari itu team besar lalu usernya kecil di bawah"*, *"ada tanggal dibuat dan sampai"*,
// the-inbound-row-says-who-and-when) — Dari is the team, who raised it small under it; Dibuat and Tiba are their own
// columns, short and with the time; Tiba names who signed for the box, and is a dash until the box is at the door. (The
// column was Sampai; it says the status's own word now — tiba-marks-and-terima-is-final.)
export const TheRowSaysWhoAndWhen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const heads = within(canvas.getByTestId("restock-inbound-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);

    await expect(heads).toEqual(["Restock", "From", "Products", "Shipment", "Status", "Created", "Arrived", "Actions"]);
    await expect(canvas.getByTestId("restock-open-501")).toHaveTextContent(/^#501$/);
    await expect(canvas.getByTestId("restock-from-501")).toHaveTextContent("Toko Melati");
    await waitFor(() => expect(canvas.getByTestId("restock-created-by-501")).toHaveTextContent(/^by /));
    await expect(canvas.getByTestId("restock-created-501")).toHaveTextContent(/^\d{1,2} \w{3} \d{2}:\d{2}$/);
    await expect(canvas.getByTestId("restock-arrived-501")).toHaveTextContent("—");
    await expect(canvas.getByTestId("restock-arrived-502")).toHaveTextContent(/\d{2}:\d{2}/);
    await waitFor(() => expect(canvas.getByTestId("restock-arrived-502-by")).toHaveTextContent("by Budi Santoso"));
  },
};

// "+N MORE" STARTS AT THE TEXT'S LEFT EDGE (owner: *"produk more harusnya sama teks rata kiri"*) — not centred in the cell.
export const TheMoreProductsLineStartsAtTheLeft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const more = within(canvas.getByTestId("restock-row-501")).getByTestId("restock-items-more");
    const summary = more.parentElement!.firstElementChild as HTMLElement;

    await expect(Math.abs(more.getBoundingClientRect().left - summary.getBoundingClientRect().left)).toBeLessThan(1);
  },
};

// THE WAREHOUSE SEES NO RESTOCK MONEY, ONLY THE COD IT PAID (owner: *"gudang tidak perlu tahu nilai restok, tapi nilai cod
// yang mereka bayarkan mungkin lebih baik"*, the-warehouse-sees-the-cod-it-paid) — no queue value; the last card is the
// courier's charge it paid this month, marked as a sample until a read sums it; no row carries a price.
export const TheWarehouseSeesOnlyTheCodItPaid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const strip = canvas.getByTestId("restock-inbound-summary");

    await expect(strip).not.toHaveTextContent("Queue value");
    const cod = canvas.getByTestId("restock-stat-cod");
    await expect(cod).toHaveTextContent("COD paid");
    await expect(canvas.getByTestId("restock-stat-cod-value")).toHaveTextContent(/^Rp /);
    await expect(cod).toHaveTextContent(/this month · \d+ restocks/);
    await expect(within(cod).getByTestId(/^not-implemented-/)).toBeVisible();
    await expect(strip.lastElementChild).toBe(cod);
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(canvas.getByTestId("restock-inbound-table")).not.toHaveTextContent("Rp");
  },
};
