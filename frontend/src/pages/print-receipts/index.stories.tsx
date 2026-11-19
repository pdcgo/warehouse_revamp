import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, markerWithSearch, routedPage } from "../../../.storybook/pageStory";
import { orders } from "../../../.storybook/fixtures";
import {
  asAdminTeam,
  orderLabelScenario,
  orderPrintScenario,
  statusChangeScenario,
} from "../../../.storybook/sessionScenario";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { PrintReceiptsPage } from "./index";
import { on110AsJnt, withLabels } from "./stories/kit";
import { UNBOXING_STORAGE_KEY } from "./unboxing";

// PRINT RECEIPTS — CETAK RESI (the-print-page-and-the-courier-count-prototype-is-accepted), `/warehouse-orders/print`. The
// page the list's Cetak Resi and a row's Print Label open (Pages/Warehouse/PickQueuePage shows the ways in): the chosen
// orders read in one call, Konfirmasi setelah dicetak ON (the owner's flow, business/inventory/order.md:113–124 — print,
// then Processed), the unboxing warning (the-unboxing-warning-is-one-sentence-on-each-label), and Print. Acceptance
// inventory/order.md:133–142.
//
//   | story                     | the rule it pins                                                                    |
//   | ------------------------- | ----------------------------------------------------------------------------------- |
//   | Default / Mobile          | the chosen orders in the list's order, each label said up front; the two switches   |
//   | Mobile · printed          | the phone after a print: the result and the blocks still fit                        |
//   | PrintThenConfirm          | one OrderLabels, the PDF opens, To confirm orders in it move — once; left out named  |
//   | ConfirmAfterPrintingOff   | the labels print, every order stays To confirm                                       |
//   | AReprintKeepsItsStep      | a Confirmed order's label prints, its step does not move                             |
//   | ReadInOneCall             | every chosen order in ONE OrderPrintByIds; another warehouse's order reads not found |
//   | TheUnboxingWarningPrints  | the switch on: OrderLabels is asked for the warning, the result says so; remembered |
//   | TheUnboxingSwitchIsRemembered | a device that turned it on opens with it on; off forgets it                     |
//   | NothingPrintable          | no PDF opens; each order says why (a broken file, no label); nothing moves          |
//   | TakeAnOrderOff            | ✕ takes one off, the address follows; the last one stays                             |
//   | AMonitorPrintsOnly        | a monitoring team prints; the switch is off and locked; nothing moves                |
//   | BackGoesWhereItWasOpened  | back returns to the list with its tab and filters                                    |
//   | NothingChosen / ASellingTeamIsTurnedAway | the empty address; a seller has no shelves                            |
//
// The orders, Gudang Pusat (11)'s: 110 (Kenanga, To confirm, J&T — moved from #95 for these stories so every courier has a
// name), 103 (Melati, Confirmed — a reprint), 102 (Melati, To confirm, NO label), 101 (Melati, To confirm). 101 carries
// its label in the fixtures; 110 and 103 get one here.

const FOUR = "110,103,102,101";

function routes() {
  return [
    {
      path: "/warehouse-orders/print",
      element: (
        <>
          <PrintReceiptsPage />
          <LocationProbe hidden />
        </>
      ),
    },
    markerWithSearch("/warehouse-orders", "at-warehouse-orders"),
  ];
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const AtFour = routedPage(routes(), `/warehouse-orders/print?ids=${FOUR}`);
const AtReprint = routedPage(routes(), "/warehouse-orders/print?ids=103");
const AtNone = routedPage(routes(), "/warehouse-orders/print");
// An order another warehouse ships — not this one's to print.
const ELSEWHERE = orders.find((o) => o.warehouseId !== 11n && o.warehouseId !== 0n)!;
const AtFourAndAnother = routedPage(routes(), `/warehouse-orders/print?ids=${FOUR},${ELSEWHERE.id}`);
const AtNothingPrintable = routedPage(routes(), "/warehouse-orders/print?ids=110,102");
const FromTheList = routedPage(routes(), {
  pathname: "/warehouse-orders/print",
  search: "?ids=110,102",
  state: { from: "/warehouse-orders?step=toConfirm&courier=91" },
});

const meta = {
  title: "Pages/Warehouse/PrintReceipts",
  component: PrintReceiptsPage,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    // The unboxing switch is remembered on the device — every story starts from a device that never touched it.
    window.localStorage.removeItem(UNBOXING_STORAGE_KEY);
    const restoreLabels = withLabels(110n, 103n);
    const restoreCourier = on110AsJnt();
    // The PDF opens in a new tab — answered here, so a story reads what was opened.
    const open = spyOn(window, "open").mockReturnValue(null);

    return () => {
      open.mockRestore();
      restoreCourier();
      restoreLabels();
      window.localStorage.removeItem(UNBOXING_STORAGE_KEY);
    };
  },
  render: () => <AtFour />,
} satisfies Meta<typeof PrintReceiptsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page, once every chosen order is on it. */
async function page(canvasElement: HTMLElement, ids = [110n, 103n, 102n, 101n]) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("print-receipts-orders", {}, { timeout: 4000 });
  for (const id of ids) {
    await waitFor(() => expect(canvas.getByTestId(`print-receipts-step-${id}`)).toBeInTheDocument());
  }
  return canvas;
}

/** The orders as they are listed — a table row on a desktop, a block on a phone. */
function listed(canvasElement: HTMLElement): string[] {
  return [...canvasElement.querySelectorAll("[data-testid^='print-receipts-row-'], [data-testid^='print-receipts-block-']")].map(
    (el) => el.getAttribute("data-testid")!.replace(/^print-receipts-(row|block)-/, ""),
  );
}

const stepOf = (canvasElement: HTMLElement, id: bigint) =>
  within(canvasElement).getByTestId(`print-receipts-step-${id}`).getAttribute("data-status");

/**
 * THE CHOSEN ORDERS, IN THE LIST'S ORDER — each with its shop, courier and resi, its step, and whether a label is attached:
 * 102 has none, and says so BEFORE anything is printed. Confirm after printing is ON (the owner's flow: print, then
 * Processed); the unboxing switch is off and carries its ⚠ mark. Settings beside the orders on a desktop.
 */
export const Default: Story = {
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    await expect(canvas.getByTestId("print-receipts-heading")).toHaveTextContent("Print Labels · 4 Orders");
    await expect(listed(canvasElement)).toEqual(["110", "103", "102", "101"]);
    await expect(canvas.getByTestId("print-receipts-table")).toBeInTheDocument();
    await expect(canvas.getByTestId("print-receipts-list-line")).toHaveTextContent("4 orders · 1 without a label · 3 to confirm");

    await expect(canvas.getByTestId("print-receipts-label-102")).toHaveAttribute("data-label", "missing");
    await expect(canvas.getByTestId("print-receipts-label-102")).toHaveTextContent("No label");
    for (const id of [110n, 103n, 101n]) {
      await expect(canvas.getByTestId(`print-receipts-label-${id}`)).toHaveAttribute("data-label", "attached");
    }
    await expect(stepOf(canvasElement, 103n)).toBe(String(OrderStatus.PROCESSED));
    await expect(stepOf(canvasElement, 110n)).toBe(String(OrderStatus.PENDING));
    // 110's courier and resi, as the list's AWB column draws them.
    await expect(within(canvas.getByTestId("print-receipts-row-110")).getByText("J&T")).toBeInTheDocument();

    const statusChange = within(canvas.getByTestId("print-receipts-status-change")).getByRole("checkbox", { hidden: true });
    await expect(statusChange).toBeChecked();
    await expect(canvas.getByTestId("print-receipts-status-change-hint")).toHaveTextContent(
      "Orders still To confirm move to Confirmed once their label is in the PDF",
    );
    const unboxing = within(canvas.getByTestId("print-receipts-unboxing")).getByRole("checkbox", { hidden: true });
    await expect(unboxing).not.toBeChecked();

    // Nothing is printed or moved by opening the page.
    await expect(orderLabelScenario.last).toBeUndefined();
    await expect(statusChangeScenario.calls).toHaveLength(0);

    // The settings stand beside the orders on a desktop, the back icon and Print in the title's row.
    const settings = canvas.getByTestId("print-receipts-settings").getBoundingClientRect();
    const list = canvas.getByTestId("print-receipts-orders").getBoundingClientRect();
    await expect(settings.right).toBeLessThanOrEqual(list.left);
    await expect(canvas.getByTestId("print-receipts-back")).toHaveTextContent("");
    await expect(canvas.getByTestId("print-receipts-print")).toHaveTextContent("Print");
  },
};

/**
 * A PHONE (every-page-has-a-mobile-story) — ONE header row, Print its icon (a-phone-header-action-is-an-icon); every order a
 * block (a-phone-reads-each-line-as-a-block); the settings above the orders; nothing past the screen's edge.
 */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    await expect(canvas.getByTestId("print-receipts-blocks")).toBeInTheDocument();
    await expect(canvas.queryByTestId("print-receipts-table")).toBeNull();
    await expect(listed(canvasElement)).toEqual(["110", "103", "102", "101"]);

    const print = canvas.getByTestId("print-receipts-print");
    await expect(print).toHaveAccessibleName("Print");
    await expect(print).toHaveTextContent("");
    const middle = (el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    };
    await expect(Math.abs(middle(print) - middle(canvas.getByTestId("print-receipts-back")))).toBeLessThan(4);
    await expect(
      canvas.getByTestId("print-receipts-settings").compareDocumentPosition(canvas.getByTestId("print-receipts-orders")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expect(canvas.getByTestId("print-receipts-label-102")).toHaveAttribute("data-label", "missing");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/** A PHONE, PRINTED — the result and the blocks' new lines (moved, left out and why) still fit the screen. */
export const MobilePrinted: Story = {
  name: "Mobile · printed",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(canvas.getByTestId("print-receipts-open-pdf")).toBeVisible());
    await expect(canvas.getByTestId("print-receipts-result-moves")).toHaveTextContent("2 orders moved to Confirmed");
    await expect(canvas.getByTestId("print-receipts-moved-101")).toHaveTextContent("Moved just now");
    await expect(canvas.getByTestId("print-receipts-label-102")).toHaveTextContent("Not in the PDFNo label attached");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/**
 * PRINT, THEN CONFIRMED (acceptance order.md:133–136, 138) — ONE OrderLabels with the four, in the page's order; the
 * merged PDF of the three with a label opens; then ONE OrderStatusChange moves the two To confirm orders the PDF holds
 * (110, 101) to Confirmed. 103 was Confirmed already — a reprint, it keeps its step; 102 was left out — no label, named
 * on its row and in the result — and stays To confirm. Printing AGAIN moves nothing: nothing is waiting any more.
 */
export const PrintThenConfirm: Story = {
  name: "Print, then confirmed",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    await userEvent.click(canvas.getByTestId("print-receipts-print"));

    await waitFor(() => expect(orderLabelScenario.last).toEqual({ teamId: 11n, orderIds: [110n, 103n, 102n, 101n] }));
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        "https://example.invalid/labels/merged-110-103-101.pdf",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    await waitFor(() => expect(statusChangeScenario.calls).toHaveLength(1));
    await expect(statusChangeScenario.calls[0]).toEqual({ teamId: 11n, orderIds: [110n, 101n], to: OrderStatus.PROCESSED });

    const result = await canvas.findByTestId("print-receipts-result");
    await expect(within(result).getByTestId("print-receipts-result-title")).toHaveTextContent("3 of 4 labels in the PDF");
    await expect(within(result).getByTestId("print-receipts-result-moves")).toHaveTextContent("2 orders moved to Confirmed");
    await expect(within(result).getByTestId("print-receipts-result-left-out-102")).toHaveTextContent(
      "Order #102 has no label attached yet — ask the seller to attach it",
    );
    await expect(within(result).getByTestId("print-receipts-open-pdf")).toHaveAttribute(
      "href",
      "https://example.invalid/labels/merged-110-103-101.pdf",
    );

    await waitFor(() => expect(stepOf(canvasElement, 110n)).toBe(String(OrderStatus.PROCESSED)));
    await expect(stepOf(canvasElement, 101n)).toBe(String(OrderStatus.PROCESSED));
    await expect(canvas.getByTestId("print-receipts-moved-110")).toHaveTextContent("Moved just now");
    await expect(stepOf(canvasElement, 103n)).toBe(String(OrderStatus.PROCESSED));
    await expect(canvas.queryByTestId("print-receipts-moved-103")).toBeNull();
    await expect(stepOf(canvasElement, 102n)).toBe(String(OrderStatus.PENDING));
    await expect(canvas.queryByTestId("print-receipts-moved-102")).toBeNull();
    await expect(canvas.getByTestId("print-receipts-label-102")).toHaveAttribute("data-label", "leftOut");
    await expect(canvas.getByTestId("print-receipts-label-102")).toHaveTextContent("Not in the PDFNo label attached");
    await expect(canvas.getByTestId("print-receipts-label-101")).toHaveAttribute("data-label", "printed");

    // Again — the labels print, and nothing is waiting to be confirmed any more.
    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(window.open).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(canvas.getByTestId("print-receipts-result-moves")).toHaveTextContent(
        "No order was waiting to be confirmed — every step stays.",
      ),
    );
    await expect(statusChangeScenario.calls).toHaveLength(1);
  },
};

/** CONFIRM AFTER PRINTING OFF (acceptance order.md:139–140) — the labels print, and every order stays To confirm. */
export const ConfirmAfterPrintingOff: Story = {
  name: "Confirm after printing off",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    await userEvent.click(within(canvas.getByTestId("print-receipts-status-change")).getByText("Confirm after printing"));
    await waitFor(() =>
      expect(canvas.getByTestId("print-receipts-status-change-hint")).toHaveTextContent(
        "The labels print and every order keeps its step.",
      ),
    );
    await expect(canvas.getByTestId("print-receipts-list-line")).toHaveTextContent("4 orders · 1 without a label");
    await expect(canvas.getByTestId("print-receipts-list-line")).not.toHaveTextContent("to confirm");

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(orderLabelScenario.last?.orderIds).toEqual([110n, 103n, 102n, 101n]));
    await waitFor(() =>
      expect(canvas.getByTestId("print-receipts-result-moves")).toHaveTextContent(
        "Confirm after printing was off — every order keeps its step.",
      ),
    );
    await expect(window.open).toHaveBeenCalledTimes(1);
    await expect(statusChangeScenario.calls).toHaveLength(0);
    for (const id of [110n, 102n, 101n]) {
      await expect(stepOf(canvasElement, id)).toBe(String(OrderStatus.PENDING));
    }
  },
};

/** A REPRINT (acceptance order.md:141–142) — one Confirmed order: its label prints, its step does not move. */
export const AReprintKeepsItsStep: Story = {
  name: "A reprint keeps its step",
  globals: { viewport: { value: "desktop1440" } },
  render: () => <AtReprint />,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, [103n]);

    await expect(canvas.getByTestId("print-receipts-heading")).toHaveTextContent("Print Labels · 1 Order");
    await userEvent.click(canvas.getByTestId("print-receipts-print"));

    // ONE id links that order's own file (a-warehouse-prints-the-labels-of-orders-it-ships).
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith("https://example.invalid/label/doc-103", "_blank", "noopener,noreferrer"),
    );
    await waitFor(() => expect(canvas.getByTestId("print-receipts-result-title")).toHaveTextContent("1 of 1 labels in the PDF"));
    await expect(canvas.getByTestId("print-receipts-result-moves")).toHaveTextContent(
      "No order was waiting to be confirmed — every step stays.",
    );
    await expect(statusChangeScenario.calls).toHaveLength(0);
    await expect(stepOf(canvasElement, 103n)).toBe(String(OrderStatus.PROCESSED));
  },
};

/**
 * EVERY CHOSEN ORDER IN ONE READ — OrderPrintByIds with the page's ids in its order, never one OrderDetail per order (the
 * prototype's interim read). An order this warehouse does not ship is absent from the answer, and its line says so; it
 * cannot be printed here either.
 */
export const ReadInOneCall: Story = {
  name: "Read in one call",
  globals: { viewport: { value: "desktop1440" } },
  render: () => <AtFourAndAnother />,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    await expect(orderPrintScenario.calls.length).toBeGreaterThan(0);
    for (const call of orderPrintScenario.calls) {
      await expect(call).toEqual({ teamId: 11n, orderIds: [110n, 103n, 102n, 101n, ELSEWHERE.id] });
    }

    await expect(listed(canvasElement)).toEqual(["110", "103", "102", "101", String(ELSEWHERE.id)]);
    await waitFor(() =>
      expect(canvas.getByTestId(`print-receipts-read-error-${ELSEWHERE.id}`)).toHaveTextContent(
        "Not an order of this warehouse.",
      ),
    );
    await expect(canvas.queryByTestId(`print-receipts-step-${ELSEWHERE.id}`)).toBeNull();
  },
};

/**
 * THE UNBOXING WARNING PRINTS (the-unboxing-warning-is-one-sentence-on-each-label): off on a device that never touched
 * it; on, OrderLabels is asked to stamp its one sentence on every label page — the server owns the words, the page sends
 * a yes — the result says every page carries it, and the device remembers the switch.
 */
export const TheUnboxingWarningPrints: Story = {
  name: "The unboxing warning prints",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    const unboxing = within(canvas.getByTestId("print-receipts-unboxing")).getByRole("checkbox", { hidden: true });
    await expect(unboxing).not.toBeChecked();
    await expect(canvas.getByTestId("print-receipts-unboxing-hint")).toHaveTextContent("The labels print as they are.");
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();

    await userEvent.click(within(canvas.getByTestId("print-receipts-unboxing")).getByText("Unboxing video warning"));
    await waitFor(() => expect(unboxing).toBeChecked());
    await expect(canvas.getByTestId("print-receipts-unboxing-hint")).toHaveTextContent(
      "Every label page carries the unboxing-video sentence at its foot.",
    );
    await expect(window.localStorage.getItem(UNBOXING_STORAGE_KEY)).toBe("on");

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(orderLabelScenario.last).toEqual({ teamId: 11n, orderIds: [110n, 103n, 102n, 101n] }));
    await expect(orderLabelScenario.unboxing).toBe(true);
    await waitFor(() =>
      expect(canvas.getByTestId("print-receipts-result-unboxing")).toHaveTextContent(
        "Every label page carries the unboxing-video warning.",
      ),
    );
  },
};

/**
 * THE SWITCH IS REMEMBERED ON THIS DEVICE (the-label-settings-are-remembered, as Cetak Label's): a device that turned it
 * on opens the page with it on, and a print asks for the warning; turned off, the device forgets it and the next print
 * does not ask.
 */
export const TheUnboxingSwitchIsRemembered: Story = {
  name: "The unboxing switch is remembered",
  globals: { viewport: { value: "desktop1440" } },
  beforeEach: () => {
    window.localStorage.setItem(UNBOXING_STORAGE_KEY, "on");
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    const unboxing = within(canvas.getByTestId("print-receipts-unboxing")).getByRole("checkbox", { hidden: true });
    await expect(unboxing).toBeChecked();

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(orderLabelScenario.unboxing).toBe(true));

    await userEvent.click(within(canvas.getByTestId("print-receipts-unboxing")).getByText("Unboxing video warning"));
    await waitFor(() => expect(unboxing).not.toBeChecked());
    await expect(window.localStorage.getItem(UNBOXING_STORAGE_KEY)).toBeNull();

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(orderLabelScenario.unboxing).toBe(false));
    await waitFor(() => expect(canvas.queryByTestId("print-receipts-result-unboxing")).toBeNull());
  },
};

/**
 * NOTHING PRINTABLE — 110's file cannot be read and 102 has no label: no PDF opens, the result says no label could be
 * printed and names each order with its reason, and nothing moves (nothing was printed).
 */
export const NothingPrintable: Story = {
  name: "Nothing printable",
  globals: { viewport: { value: "desktop1440" } },
  render: () => <AtNothingPrintable />,
  beforeEach: () => {
    orderLabelScenario.unreadable = [110n];
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, [110n, 102n]);

    await userEvent.click(canvas.getByTestId("print-receipts-print"));

    await waitFor(() => expect(canvas.getByTestId("print-receipts-result-title")).toHaveTextContent("No label could be printed"));
    await expect(canvas.getByTestId("print-receipts-result-left-out-110")).toHaveTextContent(
      "The label file of order #110 can't be read",
    );
    await expect(canvas.getByTestId("print-receipts-result-left-out-102")).toHaveTextContent(
      "Order #102 has no label attached yet — ask the seller to attach it",
    );
    await expect(canvas.queryByTestId("print-receipts-open-pdf")).toBeNull();
    await expect(window.open).not.toHaveBeenCalled();
    await expect(statusChangeScenario.calls).toHaveLength(0);
  },
};

/** ✕ TAKES AN ORDER OFF — the address follows, the print sends the rest; the last order cannot be taken off. */
export const TakeAnOrderOff: Story = {
  name: "Take an order off",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    await userEvent.click(canvas.getByTestId("print-receipts-remove-102"));
    await waitFor(() => expect(listed(canvasElement)).toEqual(["110", "103", "101"]));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?ids=110,103,101"));
    await expect(canvas.getByTestId("print-receipts-heading")).toHaveTextContent("Print Labels · 3 Orders");

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(orderLabelScenario.last?.orderIds).toEqual([110n, 103n, 101n]));
    await waitFor(() => expect(canvas.getByTestId("print-receipts-result-title")).toHaveTextContent("3 of 3 labels in the PDF"));

    for (const id of [110n, 103n]) await userEvent.click(canvas.getByTestId(`print-receipts-remove-${id}`));
    await waitFor(() => expect(listed(canvasElement)).toEqual(["101"]));
    await expect(canvas.getByTestId("print-receipts-remove-101")).toBeDisabled();
  },
};

/**
 * A MONITORING TEAM PRINTS ONLY (the-admin-team-monitors-read-only) — printing is a read, so Print works; Confirm after
 * printing is off and locked, and says why; nothing moves.
 */
export const AMonitorPrintsOnly: Story = {
  name: "A monitor prints only",
  globals: { viewport: { value: "desktop1440" } },
  beforeEach: () => {
    asAdminTeam()();
    asTeam(11n)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    const statusChange = within(canvas.getByTestId("print-receipts-status-change")).getByRole("checkbox", { hidden: true });
    await expect(statusChange).not.toBeChecked();
    await expect(statusChange).toBeDisabled();
    await expect(canvas.getByTestId("print-receipts-status-change-hint")).toHaveTextContent(
      "A monitoring team prints only — no order moves.",
    );

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(orderLabelScenario.last?.orderIds).toEqual([110n, 103n, 102n, 101n]));
    await waitFor(() => expect(canvas.getByTestId("print-receipts-result")).toBeInTheDocument());
    await expect(statusChangeScenario.calls).toHaveLength(0);
  },
};

/** BACK GOES WHERE THE PAGE WAS OPENED — the list, on the tab and filters it was on (a-form-returns-where-it-was-opened). */
export const BackGoesWhereItWasOpened: Story = {
  name: "Back goes where it was opened",
  render: () => <FromTheList />,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, [110n, 102n]);

    await userEvent.click(canvas.getByTestId("print-receipts-back"));
    await waitFor(() => expect(canvas.getByTestId("at-warehouse-orders")).toBeInTheDocument());
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?step=toConfirm&courier=91");
  },
};

/** NOTHING CHOSEN — an address with no order says so, and prints nothing. */
export const NothingChosen: Story = {
  name: "Nothing chosen",
  render: () => <AtNone />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("print-receipts-empty")).toHaveTextContent("No order on this print");
    await expect(canvas.queryByTestId("print-receipts-print")).toBeNull();
  },
};

/** A SELLING TEAM IS TURNED AWAY — it ships nothing, so it prints no warehouse's labels. */
export const ASellingTeamIsTurnedAway: Story = {
  name: "A selling team is turned away",
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("print-receipts-not-warehouse")).toBeInTheDocument();
    await expect(canvas.queryByTestId("print-receipts-print")).toBeNull();
  },
};
