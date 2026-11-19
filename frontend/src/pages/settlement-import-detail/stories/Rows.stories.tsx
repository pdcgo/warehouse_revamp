import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import {
  UploadedFileLineOutcome,
  UploadedFileLineReason,
} from "../../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { AtTiktokDone, IMPORT_DETAIL_META, linesOf, loaded, shopeeDone, tiktokDone } from "./kit";

// IMPORT DETAIL — the file's rows, view by view: held, skipped and posted to the shop, as accepted, then every posted
// row and every row already there — each row shown with its result (the owner's acceptance row *open import detail*,
// backlog #93). The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

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

    await userEvent.click(canvas.getByTestId("page-next"));

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

// A view with no rows says so — Shopee's file found none already there.
export const AnEmptyViewSaysSo: Story = {
  name: "An empty view",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(shopeeDone!.tally.existing).toBe(0);
    const [held] = linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.HELD);
    await canvas.findByTestId(`line-row-${held!.id}`);

    await userEvent.click(canvas.getByTestId("lines-tab-existing"));

    await expect(canvas.getByTestId("lines-tab-existing")).toHaveTextContent("Already there (0)");
    await expect(await canvas.findByTestId("lines-empty")).toHaveTextContent("No rows here.");
    await expect(canvasElement.querySelectorAll('[data-testid^="line-row-"]')).toHaveLength(0);
  },
};
