import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { settlementImportScenario } from "../../../../.storybook/settlementImportScenario";
import {
  UploadedFileLineOutcome,
  UploadedFileLineReason,
} from "../../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { formatDayShort } from "../../../lib/datetime";
import {
  AtTiktokDone,
  IMPORT_DETAIL_META,
  heldLines,
  linesOf,
  loaded,
  postedLines,
  rowsShown,
  shopeeDone,
  tiktokDone,
} from "./kit";

// IMPORT DETAIL — the file's rows, view by view: held, skipped and posted to the shop, as accepted, then every posted
// row and every row already there — each row shown with its result (the owner's acceptance row *open import detail*,
// backlog #93). On a desktop — the phone's blocks are ./PhoneRows.stories.tsx. Then the rules every list keeps, from their
// own decisions (docs/technical/frontend/context_decision.md): the growing pager (every-list-pages-with-the-growing-pager),
// the empty hint (an-empty-list-shows-a-hint), a short day in a table cell (a-table-date-is-short-and-every-time-is-wib),
// and a tab that waits for its own rows (the-import-detail-phone-prototype-is-accepted). The page's stories are grouped by
// the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Settlement/ImportDetail/Rows",
  ...IMPORT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// HELD rows come first: they are the ones a person can do something about — and the page says what.
export const HeldRowsSayWhyAndWhatToDo: Story = {
  name: "Held · why, and what to do",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const held = linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.HELD);

    for (const line of held) {
      await canvas.findByTestId(`line-row-${line.id}`);
    }
    await expect(canvas.getByTestId(`line-reason-${held[0]!.id}`)).toHaveTextContent("nobody has mapped");
    await expect(canvas.getByTestId(`line-reason-${held[1]!.id}`)).toHaveTextContent("Refused by settlement");
    await expect(canvas.getByTestId("lines-note")).toHaveTextContent("upload the same file again");
  },
};

// only-a-successful-withdrawal-is-recorded: a failed withdrawal and its refund are skipped, and say so.
export const SkippedRowsSayWhy: Story = {
  name: "Skipped · why",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("lines-tab-skipped"));

    for (const line of linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.SKIPPED)) {
      const reason = await canvas.findByTestId(`line-reason-${line.id}`);
      await expect(reason).toHaveTextContent("did not succeed");
    }
  },
};

// an-unmatched-ref-posts-to-the-shop: a row whose order was not found went to the shop — and the page
// says an order entered later will not receive it.
export const RowsPostedToTheShop: Story = {
  name: "Posted to the shop",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("lines-tab-toShop"));

    for (const line of linesOf(shopeeDone!.id, (l) => l.reason === UploadedFileLineReason.NO_ORDER)) {
      const reason = await canvas.findByTestId(`line-reason-${line.id}`);
      await expect(reason).toHaveTextContent("No order with this ref");
    }
    await expect(canvas.getByTestId("lines-note")).toHaveTextContent("does not receive them");
  },
};

// two-live-orders-on-a-ref-post-to-the-shop: a ref on two live orders went to the shop too — the row says so, and
// names every order it found, each a link to that order, so a person can place the money.
export const ARefOnSeveralOrdersNamesThem: Story = {
  name: "A ref on several orders",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("lines-tab-toShop"));

    const [line] = linesOf(shopeeDone!.id, (l) => l.reason === UploadedFileLineReason.SEVERAL_ORDERS);
    await expect(await canvas.findByTestId(`line-reason-${line!.id}`)).toHaveTextContent("several live orders");

    for (const orderId of line!.foundOrderIds!) {
      const link = canvas.getByTestId(`line-found-order-${line!.id}-${orderId}`);
      await expect(link).toHaveTextContent(`#${orderId}`);
      await expect(link).toHaveAttribute("href", `/orders/${orderId}`);
    }

    // The tab counts it among the rows posted to the shop.
    await expect(canvas.getByTestId("lines-tab-toShop")).toHaveTextContent(String(shopeeDone!.tally.postedToShop));
  },
};

// Each row shown with its result (the owner's acceptance row *open import detail*, backlog #93): every POSTED row,
// after the accepted three views — to its order, the order a link under it; to the shop, with why — as many as the
// tally's Posted, a page at a time from the server.
export const EveryPostedRowWithItsOrder: Story = {
  name: "Posted · each with its order",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const posted = linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.POSTED);
    await expect(posted).toHaveLength(shopeeDone!.tally.posted);

    // The accepted views keep their place; the new ones follow them.
    const tabs = [...canvasElement.querySelectorAll('[data-testid^="lines-tab-"]')].map((e) =>
      e.getAttribute("data-testid"),
    );
    await expect(tabs).toEqual([
      "lines-tab-held",
      "lines-tab-skipped",
      "lines-tab-toShop",
      "lines-tab-posted",
      "lines-tab-existing",
    ]);

    await userEvent.click(canvas.getByTestId("lines-tab-posted"));
    await expect(canvas.getByTestId("lines-tab-posted")).toHaveTextContent(`Posted (${shopeeDone!.tally.posted})`);
    await expect(canvas.getByTestId("lines-note")).toHaveTextContent("Every row that posted");

    // To its order: the result, and the order — a link to it.
    const toOrder = posted.find((l) => l.orderId > 0n)!;
    await expect(await canvas.findByTestId(`line-row-${toOrder.id}`)).toHaveTextContent(toOrder.orderRef);
    await expect(canvas.getByTestId(`line-reason-${toOrder.id}`)).toHaveTextContent("Posted to its order");
    const link = canvas.getByTestId(`line-order-${toOrder.id}`);
    await expect(link).toHaveTextContent(`#${toOrder.orderId}`);
    await expect(link).toHaveAttribute("href", `/orders/${toOrder.orderId}`);

    // A row that names no order — a withdrawal — went to the shop: no order to link.
    const withdrawal = posted.find((l) => l.orderRef === "")!;
    await expect(canvas.getByTestId(`line-reason-${withdrawal.id}`)).toHaveTextContent(
      "Posted to the shop — the row names no order",
    );
    await expect(canvas.queryByTestId(`line-order-${withdrawal.id}`)).toBeNull();

    // A row posted to the shop keeps its reason and the orders it found, exactly as under Posted to the shop.
    const noOrder = posted.find((l) => l.reason === UploadedFileLineReason.NO_ORDER)!;
    await expect(canvas.getByTestId(`line-reason-${noOrder.id}`)).toHaveTextContent("No order with this ref");
    await expect(canvas.queryByTestId(`line-order-${noOrder.id}`)).toBeNull();
    const several = posted.find((l) => l.reason === UploadedFileLineReason.SEVERAL_ORDERS)!;
    await expect(canvas.getByTestId(`line-found-orders-${several.id}`)).toBeInTheDocument();

    // A page at a time: 20 of the 120, and the next page is the next 20.
    const rowsShown = () => canvasElement.querySelectorAll('[data-testid^="line-row-"]').length;
    await expect(rowsShown()).toBe(20);
    const nextFirst = posted[20]!;
    await expect(canvas.queryByTestId(`line-row-${nextFirst.id}`)).toBeNull();

    await userEvent.click(canvas.getByTestId("lines-pager-next"));

    await expect(await canvas.findByTestId(`line-row-${nextFirst.id}`)).toHaveTextContent(nextFirst.orderRef);
    await waitFor(() => expect(canvas.queryByTestId(`line-row-${toOrder.id}`)).toBeNull());
    await expect(rowsShown()).toBe(20);
    const nextLink = canvas.getByTestId(`line-order-${nextFirst.id}`);
    await expect(nextLink).toHaveAttribute("href", `/orders/${nextFirst.orderId}`);
  },
};

// The rows ALREADY THERE — their key was in the ledger, the same rows imported before (the-row-key-is-the-only-dedupe):
// each says so, its order a link when it has one.
export const RowsAlreadyThereSayWhereTheyAre: Story = {
  name: "Already there",
  render: () => <AtTiktokDone />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const existing = linesOf(tiktokDone!.id, (l) => l.outcome === UploadedFileLineOutcome.EXISTING);
    await expect(existing).toHaveLength(tiktokDone!.tally.existing);

    await userEvent.click(canvas.getByTestId("lines-tab-existing"));
    await expect(canvas.getByTestId("lines-tab-existing")).toHaveTextContent(
      `Already there (${tiktokDone!.tally.existing})`,
    );
    await expect(canvas.getByTestId("lines-note")).toHaveTextContent("already in the ledger");

    for (const line of existing) {
      const reason = await canvas.findByTestId(`line-reason-${line.id}`);
      await expect(reason).toHaveTextContent("Already in the ledger — imported before");
      if (line.orderId > 0n) {
        await expect(canvas.getByTestId(`line-order-${line.id}`)).toHaveAttribute("href", `/orders/${line.orderId}`);
      } else {
        await expect(canvas.queryByTestId(`line-order-${line.id}`)).toBeNull();
      }
    }
    await expect(canvasElement.querySelectorAll('[data-testid^="line-row-"]')).toHaveLength(existing.length);
  },
};

// A view with no rows says so — Shopee's file found none already there: the empty hint where the rows would be, its
// title the sentence the page said before (an-empty-list-shows-a-hint) — no table drawn under it; the pager stays.
export const AnEmptyViewSaysSo: Story = {
  name: "An empty view",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(shopeeDone!.tally.existing).toBe(0);
    const [held] = linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.HELD);
    await canvas.findByTestId(`line-row-${held!.id}`);

    await userEvent.click(canvas.getByTestId("lines-tab-existing"));

    await expect(canvas.getByTestId("lines-tab-existing")).toHaveTextContent("Already there (0)");
    const empty = await canvas.findByTestId("lines-empty");
    await expect(empty).toHaveTextContent("No rows here.");
    await expect(empty).toHaveClass("chakra-empty-state__root");
    await expect(empty).toBeVisible();
    await expect(canvasElement.querySelectorAll('[data-testid^="line-row-"]')).toHaveLength(0);
    await expect(canvas.queryByTestId("lines-table")).toBeNull();
    await expect(canvasElement.querySelector("table")).toBeNull();
    await expect(canvas.getByTestId("lines-pager")).toBeVisible();
  },
};

// A ROW'S DAY IS SHORT (a-table-date-is-short-and-every-time-is-wib) — the statement's day in a table cell reads *27 Sep*,
// in the app's language, the year only when it is not this year; never the raw `2026-09-27`.
export const ARowsDayIsShort: Story = {
  name: "A row's day is short",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const [, refused] = heldLines();

    const row = await canvas.findByTestId(`line-row-${refused!.id}`);
    const day = within(row).getAllByRole("cell")[0]!;
    await expect(day).toHaveTextContent(/^27 Sep( 2026)?$/);
    await expect(day).toHaveTextContent(formatDayShort(refused!.occurredOn));
    await expect(row).not.toHaveTextContent("2026-09-27");
  },
};

// A NEW TAB WAITS FOR ITS OWN ROWS — the list keeps its last answer while the next loads, right for the next page and
// wrong for another tab: Held's rows must not stand under Posted. The tab's bars show until its own rows land
// (the-import-detail-phone-prototype-is-accepted — the guard holds on the desktop too).
export const ANewTabWaitsForItsOwnRows: Story = {
  name: "A new tab waits for its own rows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const [heldFirst] = heldLines();
    await canvas.findByTestId(`line-row-${heldFirst!.id}`);

    settlementImportScenario.linesHoldMs = 400;
    await userEvent.click(canvas.getByTestId("lines-tab-posted"));
    await expect(await canvas.findByTestId("lines-loading")).toBeVisible();
    await expect(canvas.queryByTestId(`line-row-${heldFirst!.id}`)).toBeNull();
    await expect(canvasElement.querySelector(".chakra-spinner")).toBeNull();

    await expect(await canvas.findByTestId(`line-row-${postedLines()[0]!.id}`, {}, { timeout: 3000 })).toBeVisible();
    await expect(canvas.queryByTestId("lines-loading")).toBeNull();
    await expect((await canvas.findByTestId("lines-table")).tagName).toBe("TABLE");
  },
};

// THE DESKTOP AT 1366 — the table, the labelled Download, and the growing pager (every-list-pages-with-the-growing-pager):
// its per-page sizes on the left, › opening the next page and adding its number, a new page size starting the trail
// over. The phone's arrangement never shows here.
export const TheDesktopPagerGrows: Story = {
  name: "The pager grows, with its page size (1366)",
  globals: { viewport: { value: "desktop1366" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(1366);

    const table = await canvas.findByTestId("lines-table");
    await expect(table.tagName).toBe("TABLE");
    await expect(table).not.toHaveAttribute("data-layout");
    await expect(canvas.queryByTestId("import-detail-header")).toBeNull();
    await expect(canvas.getByTestId("download-original")).toHaveTextContent("Download original");
    await expect(canvas.queryByTestId("page-next")).toBeNull();

    await userEvent.click(canvas.getByTestId("lines-tab-posted"));
    const [first] = postedLines();
    await canvas.findByTestId(`line-row-${first!.id}`);
    await expect(canvas.getByTestId("lines-pager-size")).toBeVisible();
    await expect(canvas.getByTestId("lines-pager-page-1")).toHaveAttribute("aria-current", "page");

    await waitFor(() => expect(canvas.getByTestId("lines-pager-next")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("lines-pager-next"));
    await expect(await canvas.findByTestId(`line-row-${postedLines()[20]!.id}`)).toBeVisible();
    await expect(canvas.getByTestId("lines-pager-page-2")).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(canvas.getByTestId("lines-pager-page-3")).toBeVisible());

    // Fifty a page: page 1 again, the old trail gone, fifty rows.
    await userEvent.click(canvas.getByTestId("lines-pager-size"));
    const fifty = await canvas.findByRole("option", { name: "50" });
    await waitFor(() => expect(fifty).toBeVisible());
    await userEvent.click(fifty);
    await waitFor(() => expect(rowsShown(canvasElement)).toHaveLength(50));
    await expect(canvas.getByTestId("lines-pager-page-1")).toHaveAttribute("aria-current", "page");
    await expect(canvas.queryByTestId("lines-pager-page-3")).toBeNull();
  },
};
