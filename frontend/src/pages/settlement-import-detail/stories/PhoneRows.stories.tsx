import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { settlementImportScenario } from "../../../../.storybook/settlementImportScenario";
import {
  UploadedFileLineOutcome,
  UploadedFileLineReason,
} from "../../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import {
  AtTiktokDone,
  IMPORT_DETAIL_META,
  fitsTheScreen,
  heldLines,
  linesOf,
  loaded,
  postedLines,
  rowsShown,
  shopeeDone,
  tiktokDone,
} from "./kit";

// IMPORT DETAIL ON A PHONE — THE ROWS (the-import-detail-phone-prototype-is-accepted, accepted 2026-11-19): below `md`
// the page stops drawing its table, and each statement row is a block. Each part an accepted rule
// (docs/technical/frontend/context_decision.md unless named):
//
//   a block per row               a-phone-reads-each-line-as-a-block — ref · amount; the result and its order link(s);
//                                 the importer's detail; on the statement → recorded as; the day · the sheet
//   a tap on a block              opens nothing — only its order links open the order
//                                 (a-phone-import-block-opens-only-its-order-link, settlement_importer_decision.md)
//   loading                       a tab's first load is its shape, never a spinner (motion-is-small-quick-and-shared);
//                                 the next page keeps its rows, another tab never shows the previous tab's
//   empty                         an-empty-list-shows-a-hint, its title the sentence the page said before
//   pager                         every-list-pages-with-the-growing-pager, a-phone-pager-is-centred-without-a-page-size
//
// The page around them — title row, tabs, notes — is ./Phone.stories.tsx.

const meta = {
  title: "Pages/Settlement/ImportDetail/PhoneRows",
  ...IMPORT_DETAIL_META,
  globals: { viewport: { value: "phone390" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── A block ──────────────────────────────────────────────────────────────────────────────────────────────────────

// A BLOCK READS THE ROW — the desktop row's six columns, one context per line: ref · amount; the result; the importer's
// detail; what the statement calls it → what it was recorded as; the day · the sheet.
export const TheBlock: Story = {
  name: "A block reads the row",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const [unmapped, refused] = heldLines();

    const block = await canvas.findByTestId(`line-row-${refused!.id}`);
    await expect(within(block).getByTestId(`line-ref-${refused!.id}`)).toHaveTextContent("240927QRST");
    await expect(within(block).getByTestId(`line-amount-${refused!.id}`)).toHaveTextContent(/^Rp\s?212\.000$/);
    await expect(within(block).getByTestId(`line-reason-${refused!.id}`)).toHaveTextContent("Refused by settlement");
    await expect(within(block).getByTestId(`line-detail-${refused!.id}`)).toHaveTextContent(
      "unique_id already names an entry on another account",
    );
    await expect(within(block).getByTestId(`line-type-${refused!.id}`)).toHaveTextContent("Penghasilan dari Pesanan");
    await expect(within(block).getByTestId(`line-type-${refused!.id}`)).toHaveTextContent("Payout");
    await expect(within(block).getByTestId(`line-when-${refused!.id}`)).toHaveTextContent(/^27 Sep · Rincian Transaksi$/);

    // A row with no ref says so as the desktop does; money that left is red; a type nobody mapped says it.
    const other = canvas.getByTestId(`line-row-${unmapped!.id}`);
    await expect(within(other).getByTestId(`line-ref-${unmapped!.id}`)).toHaveTextContent(/^—$/);
    const amount = within(other).getByTestId(`line-amount-${unmapped!.id}`);
    await expect(amount).toHaveTextContent(/^−Rp\s?15\.000$/);
    await expect(getComputedStyle(amount).color).not.toBe(
      getComputedStyle(within(block).getByTestId(`line-amount-${refused!.id}`)).color,
    );
    await expect(within(other).getByTestId(`line-type-${unmapped!.id}`)).toHaveTextContent("Biaya Program Baru");
    await expect(within(other).getByTestId(`line-type-${unmapped!.id}`)).toHaveTextContent("Not mapped");
    await expect(within(other).queryByTestId(`line-detail-${unmapped!.id}`)).toBeNull();
    await expect(canvas.getByTestId("lines-note")).toHaveTextContent("upload the same file again");
  },
};

// A BLOCK OPENS ONLY ITS ORDER LINKS (a-phone-import-block-opens-only-its-order-link) — as the desktop row: a tap on the
// block opens nothing, and so it is not drawn as something to press (a-table-row-lights-up — a block that opens nothing
// does not light up); its order link opens the order.
export const ABlockOpensOnlyItsOrderLinks: Story = {
  name: "A block opens only its order links",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("lines-tab-posted"));

    const toOrder = postedLines().find((l) => l.orderId > 0n)!;
    const block = await canvas.findByTestId(`line-row-${toOrder.id}`);
    await expect(block.tagName).not.toBe("A");
    await expect(block).not.toHaveAttribute("role");
    await expect(block).not.toHaveAttribute("tabindex");
    await expect(getComputedStyle(block).cursor).not.toBe("pointer");

    // Taps on the block — its ref, its amount, its type line — open nothing: the page stays.
    await userEvent.click(canvas.getByTestId(`line-ref-${toOrder.id}`));
    await userEvent.click(canvas.getByTestId(`line-amount-${toOrder.id}`));
    await userEvent.click(canvas.getByTestId(`line-type-${toOrder.id}`));
    await expect(canvas.queryByTestId("at-order")).toBeNull();
    await expect(canvas.getByTestId(`line-row-${toOrder.id}`)).toBeVisible();

    // Its order link is the one thing that opens the order.
    await userEvent.click(canvas.getByTestId(`line-order-${toOrder.id}`));
    await expect(await canvas.findByTestId("at-order")).toBeInTheDocument();
  },
};

// ── Each tab's rows ──────────────────────────────────────────────────────────────────────────────────────────────

// SKIPPED — never recorded, so a skipped block has no "recorded as", only what the statement calls it.
export const SkippedBlocks: Story = {
  name: "Skipped",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("lines-tab-skipped"));

    for (const line of linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.SKIPPED)) {
      await expect(await canvas.findByTestId(`line-reason-${line.id}`)).toHaveTextContent("did not succeed");
      await expect(canvas.getByTestId(`line-type-${line.id}`)).toHaveTextContent(/^Penarikan Dana$/);
    }
    await expect(canvas.getByTestId("lines-note")).toHaveTextContent("not recorded, by design");
  },
};

// POSTED TO THE SHOP — the order was not found, or the ref is on several live orders: each of those named, a link.
export const ToTheShopBlocks: Story = {
  name: "Posted to the shop",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("lines-tab-toShop"));

    for (const line of linesOf(shopeeDone!.id, (l) => l.reason === UploadedFileLineReason.NO_ORDER)) {
      await expect(await canvas.findByTestId(`line-reason-${line.id}`)).toHaveTextContent("No order with this ref");
      await expect(canvas.queryByTestId(`line-order-${line.id}`)).toBeNull();
    }
    const [several] = linesOf(shopeeDone!.id, (l) => l.reason === UploadedFileLineReason.SEVERAL_ORDERS);
    await expect(canvas.getByTestId(`line-reason-${several!.id}`)).toHaveTextContent("several live orders");
    for (const orderId of several!.foundOrderIds!) {
      const link = canvas.getByTestId(`line-found-order-${several!.id}-${orderId}`);
      await expect(link).toHaveTextContent(`#${orderId}`);
      await expect(link).toHaveAttribute("href", `/orders/${orderId}`);
    }
    await expect(rowsShown(canvasElement)).toHaveLength(shopeeDone!.tally.postedToShop);
    await fitsTheScreen(canvasElement);
  },
};

// POSTED — every posted row with where its money went: its order (a link beside the result), or the shop.
export const PostedBlocks: Story = {
  name: "Posted, each with its order",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("lines-tab-posted"));

    const toOrder = postedLines().find((l) => l.orderId > 0n)!;
    await expect(await canvas.findByTestId(`line-reason-${toOrder.id}`)).toHaveTextContent("Posted to its order");
    const link = canvas.getByTestId(`line-order-${toOrder.id}`);
    await expect(link).toHaveTextContent(`#${toOrder.orderId}`);
    await expect(link).toHaveAttribute("href", `/orders/${toOrder.orderId}`);
    // The order link sits on the result's line, beside it.
    const reason = canvas.getByTestId(`line-reason-${toOrder.id}`).getBoundingClientRect();
    await expect(Math.abs(link.getBoundingClientRect().top - reason.top)).toBeLessThan(6);

    const withdrawal = postedLines().find((l) => l.orderRef === "")!;
    await expect(canvas.getByTestId(`line-reason-${withdrawal.id}`)).toHaveTextContent(
      "Posted to the shop — the row names no order",
    );
    await expect(canvas.queryByTestId(`line-order-${withdrawal.id}`)).toBeNull();
    await expect(canvas.getByTestId(`line-type-${withdrawal.id}`)).toHaveTextContent("Withdrawal");
    await expect(rowsShown(canvasElement)).toHaveLength(20);
    await fitsTheScreen(canvasElement);
  },
};

// ALREADY THERE — the rows whose key was in the ledger (the-row-key-is-the-only-dedupe), each saying so, its order a link
// when it has one.
export const AlreadyThereBlocks: Story = {
  name: "Already there",
  render: () => <AtTiktokDone />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const existing = linesOf(tiktokDone!.id, (l) => l.outcome === UploadedFileLineOutcome.EXISTING);

    const tab = canvas.getByTestId("lines-tab-existing");
    tab.scrollIntoView({ inline: "end", block: "nearest" });
    await userEvent.click(tab);
    await expect(tab).toHaveTextContent(`Already there (${tiktokDone!.tally.existing})`);

    for (const line of existing) {
      await expect(await canvas.findByTestId(`line-reason-${line.id}`)).toHaveTextContent(
        "Already in the ledger — imported before",
      );
      if (line.orderId > 0n) {
        await expect(canvas.getByTestId(`line-order-${line.id}`)).toHaveAttribute("href", `/orders/${line.orderId}`);
      } else {
        await expect(canvas.queryByTestId(`line-order-${line.id}`)).toBeNull();
      }
    }
    await expect(rowsShown(canvasElement)).toHaveLength(existing.length);
    await fitsTheScreen(canvasElement);
  },
};

// ── Paging, loading and empty ────────────────────────────────────────────────────────────────────────────────────

// THE PAGES GROW — 20 blocks a page; › opens the next 20 and adds its number. While it loads, the page's rows STAY on
// screen (a refresh never swaps them for a skeleton); a new tab starts the trail over.
export const ThePagesGrow: Story = {
  name: "The pages grow",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("lines-tab-posted"));

    const first = postedLines()[0]!;
    const next = postedLines()[20]!;
    await canvas.findByTestId(`line-row-${first.id}`);
    await expect(rowsShown(canvasElement)).toHaveLength(20);
    await expect(canvas.getByTestId("lines-pager-page-1")).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(canvas.getByTestId("lines-pager-next")).toBeEnabled());

    settlementImportScenario.linesHoldMs = 400;
    await userEvent.click(canvas.getByTestId("lines-pager-next"));
    // Loading the next page: the rows stay, no skeleton.
    await expect(canvas.queryByTestId("lines-loading")).toBeNull();
    await expect(canvas.getByTestId(`line-row-${first.id}`)).toBeInTheDocument();

    await expect(await canvas.findByTestId(`line-row-${next.id}`, {}, { timeout: 3000 })).toHaveTextContent(next.orderRef);
    await waitFor(() => expect(canvas.queryByTestId(`line-row-${first.id}`)).toBeNull());
    await expect(canvas.getByTestId("lines-pager-page-2")).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByTestId("lines-pager-page-1")).toBeVisible();
    await expect(canvas.getByTestId(`line-order-${next.id}`)).toHaveAttribute("href", `/orders/${next.orderId}`);

    // Another tab: page 1 again, a fresh trail.
    settlementImportScenario.linesHoldMs = 0;
    await userEvent.click(canvas.getByTestId("lines-tab-held"));
    await canvas.findByTestId(`line-row-${heldLines()[0]!.id}`);
    await expect(canvas.queryByTestId("lines-pager-page-2")).toBeNull();
    await expect(canvas.getByTestId("lines-pager-page-1")).toHaveAttribute("aria-current", "page");
  },
};

// A TAB'S FIRST LOAD — the file is there, its rows are on their way: bars in the rows' place under the tally and tabs.
export const LoadingTheRows: Story = {
  name: "Loading a tab's rows",
  beforeEach: () => {
    settlementImportScenario.linesHoldMs = 60_000;
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(await canvas.findByTestId("lines-loading")).toBeVisible();
    await expect(canvas.getByTestId("file-tally")).toBeVisible();
    await expect(canvas.getByTestId("lines-tab-held")).toBeVisible();
    await expect(rowsShown(canvasElement)).toHaveLength(0);
    await expect(canvasElement.querySelector(".chakra-spinner")).toBeNull();
  },
};

// A TAB NEVER SHOWS ANOTHER TAB'S ROWS — the list keeps its last answer while the next loads, which is right for the next
// page and wrong for another tab: Held's blocks must not stand under Posted. The tab's bars show until its own rows land.
export const ATabNeverShowsAnotherTabsRows: Story = {
  name: "A new tab waits for its own rows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const [heldFirst] = heldLines();
    await canvas.findByTestId(`line-row-${heldFirst!.id}`);

    settlementImportScenario.linesHoldMs = 400;
    await userEvent.click(canvas.getByTestId("lines-tab-posted"));
    await expect(await canvas.findByTestId("lines-loading")).toBeVisible();
    await expect(canvas.queryByTestId(`line-row-${heldFirst!.id}`)).toBeNull();

    await expect(await canvas.findByTestId(`line-row-${postedLines()[0]!.id}`, {}, { timeout: 3000 })).toBeVisible();
    await expect(canvas.queryByTestId("lines-loading")).toBeNull();
  },
};

// AN EMPTY TAB SAYS SO (an-empty-list-shows-a-hint) — where the rows would be, the sentence the page said before; the
// pager stays on screen.
export const AnEmptyTab: Story = {
  name: "An empty tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(shopeeDone!.tally.existing).toBe(0);
    await canvas.findByTestId(`line-row-${heldLines()[0]!.id}`);

    const tab = canvas.getByTestId("lines-tab-existing");
    tab.scrollIntoView({ inline: "end", block: "nearest" });
    await userEvent.click(tab);

    const empty = await canvas.findByTestId("lines-empty");
    await expect(empty).toHaveTextContent("No rows here.");
    await expect(empty).toHaveClass("chakra-empty-state__root");
    await expect(empty).toBeVisible();
    await expect(rowsShown(canvasElement)).toHaveLength(0);
    await expect(canvas.getByTestId("lines-pager")).toBeVisible();
    await expect(canvas.getByTestId("lines-note")).toHaveTextContent("already in the ledger");
  },
};
