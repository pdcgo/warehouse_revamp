import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { withOrderStatus } from "../../../../.storybook/sessionScenario";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { FULL, ORDER_DETAIL_META, Routed, WAREHOUSE } from "./kit";

// THE WAREHOUSE'S ORDER DETAIL ON A PHONE (backlog #104). The warehouse keeps the tabbed detail
// (the-detail-preview-became-the-order-detail); on a phone its tabs go ACROSS THE TOP, as the order detail's preview does
// (the-ledger-is-blocks-on-a-phone), in one row that scrolls sideways where a tab never shrinks
// (nothing-runs-past-a-phones-edge). Down the left beside the panel they left every card ~190px wide at 390: *Tambah
// Catatan* ran past its card and the Tags hint was cut. The desktop keeps them down the left, unchanged.
//
//   | story                                   | the rule it pins                                                   |
//   | --------------------------------------- | ------------------------------------------------------------------ |
//   | WarehouseTabsGoAcrossOnAPhone           | 390: one row above the panel, every card ≥ 340px, nothing past it    |
//   | TambahCatatanSitsInItsCard              | 390 in Indonesian: the longest labels — the button and the Tags hint |
//   | NothingRunsPastTheNarrowestPhone        | 320: the row, the cards and the page stay inside the screen         |
//   | WarehouseDesktopKeepsTheTabsDownTheLeft | 1440: the vertical list beside the panel, as before                 |
//
// …and (backlog #105) its lines and its header follow the phone's other two rules: each line reads as a BLOCK
// (a-phone-reads-each-line-as-a-block — the seller's page's `ItemBlocks`), and the header is ONE ROW — back as its icon,
// the number, the status, the action as its icon (the-phone-header-is-one-row, a-phone-header-action-is-an-icon).
//
//   | story                                   | the rule it pins                                                   |
//   | --------------------------------------- | ------------------------------------------------------------------ |
//   | WarehouseLinesReadAsBlocksOnAPhone      | 390: no table — a block per line, its name, SKU, harga × qty, total  |
//   | WarehouseHeaderIsOneRowOnAPhone         | 390: back · number · status · Cancel's icon on one row; it confirms  |
//   | ForceAndAcceptReturnAreIconsOnAPhone    | 390: Force Return's icon confirms; Accept Return's opens its page    |
//   | ReportFoundIsAnIconOnAPhone             | 390: a lost order's Report Found is its icon and opens its dialog    |
//   | HeaderAndLinesFitTheNarrowestPhone      | 320 in Indonesian: the row whole and on screen, the blocks in the card |
//   | WarehouseDesktopKeepsItsHeaderAndTable  | 1440: the labelled back over the title, Cancel labelled, the table   |

/** The widths the stories are judged at — in the file, so the runner sets them (addon-vitest reads the story's options). */
const VIEWPORTS = {
  phone390: { name: "Phone 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
  phone320: { name: "Phone 320", styles: { width: "320px", height: "640px" }, type: "mobile" },
  desktop1440: { name: "Desktop 1440", styles: { width: "1440px", height: "900px" }, type: "desktop" },
};
const PHONE = { viewport: { value: "phone390" } };

/** No card on the phone's Info tab is narrower than this at 390 (the screen less the shell's 12px gutters is 366). */
const CARD_FLOOR_390 = 340;

const At101 = Routed("/orders/101");

const meta = {
  title: "Pages/Order/OrderDetailPage/Phone",
  ...ORDER_DETAIL_META,
  parameters: { ...ORDER_DETAIL_META.parameters, viewport: { options: VIEWPORTS } },
  globals: PHONE,
  // Gudang Pusat ships 101 — the warehouse's tabbed detail.
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <At101 />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The warehouse's detail, once 101 has landed: its tab root, the tab row and the open panel. */
async function tabs(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const root = await canvas.findByTestId("order-detail-tabs", {}, { timeout: 4000 });
  await canvas.findByTestId("order-detail-notes", {}, { timeout: 4000 });
  const row = within(root).getByRole("tablist");
  const triggers = ["info", "timeline", "settlement"].map((key) => canvas.getByTestId(`order-detail-tab-${key}`));

  return { canvas, root, row, triggers };
}

/** The panel on screen now. */
function openPanel(root: HTMLElement): HTMLElement {
  const panel = [...root.querySelectorAll<HTMLElement>("[role='tabpanel']")].find((p) => !p.hidden);
  if (!panel) throw new Error("no tab panel is open");

  return panel;
}

/** `inner`'s bounding box lies wholly inside `outer`'s, left to right. */
async function expectInside(inner: Element, outer: Element) {
  const i = inner.getBoundingClientRect();
  const o = outer.getBoundingClientRect();

  await expect(i.width).toBeGreaterThan(0);
  await expect(i.left).toBeGreaterThanOrEqual(o.left - 0.5);
  await expect(i.right).toBeLessThanOrEqual(o.right + 0.5);
}

/** The page never scrolls sideways, and the tab row stays inside the screen. */
async function expectNothingPastTheEdge(row: HTMLElement) {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await expect(row.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  await expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
}

/** The row reads ACROSS, above the panel: one line, each tab whole, none over its neighbour. */
async function expectOneRowAbove(row: HTMLElement, triggers: HTMLElement[], panel: HTMLElement) {
  await expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().top + 0.5);

  let prevRight = -Infinity;
  for (const trigger of triggers) {
    const b = trigger.getBoundingClientRect();

    await expect(b.top).toBe(triggers[0]!.getBoundingClientRect().top);
    await expect(b.left).toBeGreaterThanOrEqual(prevRight - 0.5);
    await expect(trigger.scrollWidth).toBeLessThanOrEqual(trigger.clientWidth);
    // A tab never shrinks; the row scrolls instead (nothing-runs-past-a-phones-edge).
    await expect(getComputedStyle(trigger).flexShrink).toBe("0");
    prevRight = b.right;
  }
  await expect(getComputedStyle(row).overflowX).toBe("auto");
}

/** Every card on the open panel is at least `floor` wide, and nothing in it runs past it. */
async function expectWideCards(panel: HTMLElement, floor: number) {
  const cards = [...panel.querySelectorAll<HTMLElement>(".chakra-card__root")];

  await expect(cards.length).toBeGreaterThanOrEqual(4);
  for (const card of cards) {
    await expect(card.getBoundingClientRect().width).toBeGreaterThanOrEqual(floor);
  }
}

/**
 * ON A PHONE THE TABS GO ACROSS THE TOP. Info, Timeline, Settlement in one row above the panel; the panel takes the
 * screen's width, so every card on Info is ≥ 340px, Add Note and the Tags hint sit inside their cards, and the page never
 * scrolls sideways — on Timeline and Settlement too.
 */
export const WarehouseTabsGoAcrossOnAPhone: Story = {
  name: "Warehouse — on a phone the tabs go across the top",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const { canvas, root, row, triggers } = await tabs(canvasElement);
    await expect(window.innerWidth).toBe(390);

    await expect(root).toHaveAttribute("data-orientation", "horizontal");
    const info = openPanel(root);
    await expectOneRowAbove(row, triggers, info);
    await expect(info.getBoundingClientRect().width).toBeGreaterThanOrEqual(CARD_FLOOR_390);
    await expectWideCards(info, CARD_FLOOR_390);
    await expectInside(canvas.getByTestId("notes-add"), canvas.getByTestId("order-detail-notes"));
    await expectInside(canvas.getByTestId("order-tags-hint"), canvas.getByTestId("order-detail-tags"));
    await expectNothingPastTheEdge(row);

    // The other two tabs read at the same width.
    for (const key of ["timeline", "settlement"]) {
      await userEvent.click(canvas.getByTestId(`order-detail-tab-${key}`));
      await waitFor(() => expect(openPanel(root).id).toContain(key));
      await expect(openPanel(root).getBoundingClientRect().width).toBeGreaterThanOrEqual(CARD_FLOOR_390);
      await expectNothingPastTheEdge(row);
    }
  },
};

/** IN INDONESIAN — the longest labels: *Tambah Catatan* inside the Catatan card, the Tags hint whole inside its card. */
export const TambahCatatanSitsInItsCard: Story = {
  name: "Warehouse — on a phone, Tambah Catatan sits in its card",
  globals: { ...PHONE, locale: "id" },
  play: async ({ canvasElement }) => {
    const { canvas, root, row } = await tabs(canvasElement);
    await expect(window.innerWidth).toBe(390);

    const add = canvas.getByTestId("notes-add");
    await expect(add).toHaveTextContent("Tambah Catatan");
    await expectInside(add, canvas.getByTestId("order-detail-notes"));
    await expectInside(canvas.getByTestId("order-tags-hint"), canvas.getByTestId("order-detail-tags"));
    await expectWideCards(openPanel(root), CARD_FLOOR_390);
    await expectNothingPastTheEdge(row);
  },
};

/** THE NARROWEST PHONE (320, nothing-runs-past-a-phones-edge): the row, the buttons and the page stay on the screen. */
export const NothingRunsPastTheNarrowestPhone: Story = {
  name: "Warehouse — at 320 nothing runs past the edge",
  globals: { viewport: { value: "phone320" }, locale: "id" },
  play: async ({ canvasElement }) => {
    const { canvas, root, row, triggers } = await tabs(canvasElement);
    await expect(window.innerWidth).toBe(320);

    await expect(root).toHaveAttribute("data-orientation", "horizontal");
    await expectOneRowAbove(row, triggers, openPanel(root));
    await expectInside(canvas.getByTestId("notes-add"), canvas.getByTestId("order-detail-notes"));
    await expectInside(canvas.getByTestId("order-tags-hint"), canvas.getByTestId("order-detail-tags"));
    await expectNothingPastTheEdge(row);
  },
};

/** THE DESKTOP IS UNCHANGED: the vertical list down the left (10rem), the panel beside it. */
export const WarehouseDesktopKeepsTheTabsDownTheLeft: Story = {
  name: "Warehouse — on a desktop the tabs stay down the left",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const { root, row } = await tabs(canvasElement);
    await expect(window.innerWidth).toBe(1440);

    await expect(root).toHaveAttribute("data-orientation", "vertical");
    const panel = openPanel(root).getBoundingClientRect();
    const list = row.getBoundingClientRect();

    await expect(list.width).toBeGreaterThanOrEqual(160);
    await expect(list.right).toBeLessThanOrEqual(panel.left + 0.5);
    await expect(list.top).toBeLessThan(panel.bottom);
    await expect(getComputedStyle(row).overflowX).toBe("visible");
  },
};


// ── #105: THE LINES AS BLOCKS AND THE HEADER IN ONE ROW ─────────────────────────────────────────────────────────────

/** The header's parts on 101's page, once it has landed. */
async function header(canvasElement: HTMLElement, actionTestId: string) {
  const canvas = within(canvasElement);
  const title = await canvas.findByTestId("order-detail-title", {}, { timeout: 4000 });
  const action = await canvas.findByTestId(actionTestId, {}, { timeout: 4000 });
  const badge = canvas.getByTestId(/^order-status-/);

  return { canvas, back: canvas.getByTestId("order-detail-back"), title, badge, action };
}

/** A vertical centre — the parts of one row share it. */
function middle(el: Element): number {
  const b = el.getBoundingClientRect();

  return (b.top + b.bottom) / 2;
}

/**
 * ONE ROW: back, the number, the status and the action side by side on the same line, left to right, none over its
 * neighbour, all on the screen. Back and the action are ICONS — named by their aria-label, no text drawn — and the
 * number is whole.
 */
async function expectOneHeaderRow(
  parts: { back: HTMLElement; title: HTMLElement; badge: HTMLElement; action: HTMLElement },
  names: { back: string; action: string },
) {
  const { back, title, badge, action } = parts;

  await expect(back).toHaveAttribute("aria-label", names.back);
  await expect(back.textContent?.trim()).toBe("");
  await expect(action.tagName).toBe("BUTTON");
  await expect(action).toHaveAttribute("aria-label", names.action);
  await expect(action.textContent?.trim()).toBe("");

  const row = [back, title, badge, action];
  for (const part of row) {
    await expect(Math.abs(middle(part) - middle(back))).toBeLessThanOrEqual(2);
  }
  for (let i = 1; i < row.length; i++) {
    await expect(row[i]!.getBoundingClientRect().left).toBeGreaterThanOrEqual(row[i - 1]!.getBoundingClientRect().right - 0.5);
  }
  await expect(back.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  await expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  await expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth);
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

/**
 * THE LINES AS BLOCKS (a-phone-reads-each-line-as-a-block): no table on the Info tab — `order-detail-items` is the list
 * of blocks, each line `order-item-<sku>` as the desktop row is. Each reads its name and SKU, then harga beli × qty and
 * the line total, all inside the Items card; nothing scrolls sideways.
 */
async function expectLinesAsBlocks(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const list = await canvas.findByTestId("order-detail-items", {}, { timeout: 4000 });
  const card = list.closest(".chakra-card__root")!;

  await expect(list.tagName).not.toBe("TABLE");
  await expect(card.querySelector("table")).toBeNull();
  await expect(list.children.length).toBe(FULL.items.length);

  for (const item of FULL.items) {
    const block = within(list).getByTestId(`order-item-${item.productCode}`);
    await expect(block).toHaveTextContent(item.name);
    await expect(block).toHaveTextContent(item.productCode);
    await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth);
    await expectInside(block, card);
  }
  // Kaos Polos Hitam — M: two at Rp 48.000 is Rp 96.000, read as a sentence.
  const first = within(list).getByTestId("order-item-KPH-M");
  await expect(first).toHaveTextContent("Rp 48.000 × 2");
  await expect(first).toHaveTextContent("Rp 96.000");
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

/** AT 390 EACH LINE IS A BLOCK — the table that scrolled five columns inside its card is gone. */
export const WarehouseLinesReadAsBlocksOnAPhone: Story = {
  name: "Warehouse — on a phone each line reads as a block",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByTestId("order-detail-notes", {}, { timeout: 4000 });
    await expect(window.innerWidth).toBe(390);

    await expectLinesAsBlocks(canvasElement);
  },
};

/**
 * AT 390 THE HEADER IS ONE ROW: ← · Order #101 · Pending · Cancel's ⊘. Back is its icon (no *Back to Orders* row over
 * the title), Cancel its icon named *Cancel Order* — and pressing it still asks before it cancels.
 */
export const WarehouseHeaderIsOneRowOnAPhone: Story = {
  name: "Warehouse — on a phone the header is one row",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const parts = await header(canvasElement, "order-cancel");
    await expect(window.innerWidth).toBe(390);

    await expectOneHeaderRow(parts, { back: "Back to Orders", action: "Cancel Order" });

    // The action still confirms first (destructive actions always confirm), and dismissing leaves the order as it was.
    await userEvent.click(parts.action);
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText("Cancel order #101? This can't be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("confirm-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("confirm-action")).not.toBeInTheDocument());
    await expect(parts.canvas.getByTestId(`order-status-${OrderStatus.PENDING}`)).toBeInTheDocument();
  },
};

const At106 = Routed("/orders/106");

/**
 * THE RETURN ON A PHONE: 106 read as completed — Force Return is its icon on the row and confirms; once the order reads
 * `return`, Accept Return is the row's icon instead and opens the accept page.
 */
export const ForceAndAcceptReturnAreIconsOnAPhone: Story = {
  name: "Warehouse — on a phone Force Return and Accept Return are icons",
  globals: PHONE,
  beforeEach: () => {
    asTeam(WAREHOUSE.id)();
    withOrderStatus(106n, OrderStatus.COMPLETED)();
  },
  render: () => <At106 />,
  play: async ({ canvasElement }) => {
    const parts = await header(canvasElement, "order-force-return");
    await expect(window.innerWidth).toBe(390);
    await expectOneHeaderRow(parts, { back: "Back to Orders", action: "Force Return" });

    await userEvent.click(parts.action);
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const accept = await parts.canvas.findByTestId("order-accept-return", {}, { timeout: 4000 });
    await expect(parts.canvas.queryByTestId("order-force-return")).toBeNull();
    await expectOneHeaderRow({ ...parts, badge: parts.canvas.getByTestId(/^order-status-/), action: accept }, {
      back: "Back to Orders",
      action: "Accept Return",
    });

    await userEvent.click(accept);
    await waitFor(() => expect(parts.canvas.getByTestId("at-return-accept")).toBeInTheDocument());
  },
};

/** A LOST ORDER ON A PHONE: Report Found is its icon on the row, and it opens the dialog prefilled with the order. */
export const ReportFoundIsAnIconOnAPhone: Story = {
  name: "Warehouse — on a phone Report Found is an icon",
  globals: PHONE,
  beforeEach: () => {
    asTeam(WAREHOUSE.id)();
    withOrderStatus(106n, OrderStatus.LOST)();
  },
  render: () => <At106 />,
  play: async ({ canvasElement }) => {
    const parts = await header(canvasElement, "order-report-found");
    await expect(window.innerWidth).toBe(390);
    await expectOneHeaderRow(parts, { back: "Back to Orders", action: "Report Found" });

    await userEvent.click(parts.action);
    const box = await screen.findByTestId("report-found-order-dialog");
    await waitFor(() => expect(box).toBeVisible());
    await expect(box).toHaveTextContent("Report Found from Order #106");
  },
};

/** THE NARROWEST PHONE IN INDONESIAN (320): the row whole and on the screen, the blocks inside their card. */
export const HeaderAndLinesFitTheNarrowestPhone: Story = {
  name: "Warehouse — at 320 the header row and the blocks fit",
  globals: { viewport: { value: "phone320" }, locale: "id" },
  play: async ({ canvasElement }) => {
    const parts = await header(canvasElement, "order-cancel");
    await expect(window.innerWidth).toBe(320);

    await expectOneHeaderRow(parts, { back: "Kembali ke Pesanan", action: "Batalkan Pesanan" });
    await expectLinesAsBlocks(canvasElement);
  },
};

/** THE DESKTOP IS UNCHANGED: *Back to Orders* labelled over the title, Cancel labelled beside it, the lines a table. */
export const WarehouseDesktopKeepsItsHeaderAndTable: Story = {
  name: "Warehouse — on a desktop the header and the table stay",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const { canvas, back, title, action } = await header(canvasElement, "order-cancel");
    await expect(window.innerWidth).toBe(1440);

    await expect(back).toHaveTextContent("Back to Orders");
    await expect(back.getBoundingClientRect().bottom).toBeLessThanOrEqual(title.getBoundingClientRect().top);
    await expect(action).toHaveTextContent("Cancel");
    await expect(canvas.getByTestId("order-detail-items").tagName).toBe("TABLE");
  },
};
