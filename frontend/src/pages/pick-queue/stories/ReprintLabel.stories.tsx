import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { orders } from "../../../../.storybook/fixtures";
import { REPRINT, reprintLabelScenario, withReprintedOrders } from "../../../../.storybook/reprintLabelScenario";
import { statusChangeScenario } from "../../../../.storybook/sessionScenario";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { PHONE_VIEWPORTS, fitsTheScreen } from "../../../features/warehouseTransfer/storyPhone";
import { PrintReceiptsPage } from "../../print-receipts/index";
import { PickQueuePage } from "../index";

// CETAK ULANG LABEL on the WAREHOUSE'S ORDER LIST (a-changed-label-asks-the-warehouse-to-reprint, accepted as drawn in
// the-reprint-label-prototype-is-accepted) — live: the badge is the server's `Order.reprint_label`, read by the real list
// against the stub (.storybook/reprintLabelScenario.ts keeps the two stamps and the server's rule). Gudang Pusat (11) on
// /warehouse-orders: 103 (Dikonfirmasi — printed 3 h ago, resi and label replaced 1 h ago) and 105 (Sudah diambil —
// printed 5 h ago, label replaced 40 min ago) are marked; 104 (changed BEFORE its print), 101 (changed, never printed) and
// 110 (printed, never changed) are not.
//
//   | story                          | what it pins                                                                   |
//   | ------------------------------ | ------------------------------------------------------------------------------ |
//   | Default                        | the badge beside the status, on the two marked rows, none else                 |
//   | Phone                          | on a phone the badge is a line of its own in the block; the blocks fit 390 px   |
//   | NeedsReprintFilter             | Perlu cetak ulang narrows on the server: the tab counts follow, ?reprint=1, Clear |
//   | OpensFiltered                  | ?reprint=1 opens the list filtered, the box ticked                              |
//   | PrintLabelClearsTheBadge       | the row's ⋯ Print Label → the print page marks it → Print records it → gone     |
//   | HandoverRefusesAMarkedParcel   | the scan keeps a marked parcel back (Reprint the label first), hands one over   |
//   | TheBarsHandoverRefusesIt       | the bar's Serah Kurir: the server refuses the marked one in its own words       |

const WAREHOUSE = 11n; // Gudang Pusat
const MARKED = [REPRINT.confirmed, REPRINT.picked].map(String).sort();
const UNMARKED = [REPRINT.changedBeforeThePrint, REPRINT.neverPrinted, REPRINT.printedUnchanged];
const resiOf = (id: bigint) => orders.find((o) => o.id === id)!.receiptCode;

const routes = [
  {
    path: "/warehouse-orders",
    element: (
      <>
        <PickQueuePage />
        <LocationProbe hidden />
      </>
    ),
  },
  // A row's Print Label opens the print page (Pages/Warehouse/PrintReceipts) — mounted for real, so its Print records the
  // print the list reads on the way back.
  { path: "/warehouse-orders/print", element: <PrintReceiptsPage /> },
  marker("/warehouse-orders/:orderId", "at-pick-order"),
];

const AtAll = routedPage(routes, "/warehouse-orders?step=all");
const AtAllFiltered = routedPage(routes, "/warehouse-orders?step=all&reprint=1");
const AtPicked = routedPage(routes, "/warehouse-orders?step=picked");

const PHONE = { viewport: { value: "phone390" } };

const meta = {
  title: "Pages/Warehouse/PickQueuePage/ReprintLabel",
  component: PickQueuePage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen", viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: () => {
    asTeam(WAREHOUSE)();
    const restore = withReprintedOrders();
    // The PDF opens in a new tab — answered here.
    const open = spyOn(window, "open").mockReturnValue(null);

    return () => {
      open.mockRestore();
      restore();
    };
  },
  render: () => <AtAll />,
} satisfies Meta<typeof PickQueuePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The row's own element — a table row on a desktop canvas, a block on a phone. */
async function rowOf(canvasElement: HTMLElement, id: bigint) {
  const canvas = within(canvasElement);
  return waitFor(() => canvas.queryByTestId(`pick-queue-row-${id}`) ?? canvas.getByTestId(`pick-queue-block-${id}`), {
    timeout: 4000,
  });
}

/** Every order showing the badge, by id. */
const badged = (canvasElement: HTMLElement) =>
  Array.from(canvasElement.querySelectorAll("[data-testid^='order-reprint-label-']"))
    .map((el) => el.getAttribute("data-testid")!.replace("order-reprint-label-", ""))
    .sort();

/** A header action — its button on a desktop, a line of the ⋯ menu on a phone. */
async function headerAction(canvasElement: HTMLElement, testId: string) {
  const canvas = within(canvasElement);
  const inline = canvas.queryByTestId(testId);
  if (inline) {
    await userEvent.click(inline);
    return;
  }
  await userEvent.click(canvas.getByTestId("warehouse-orders-actions"));
  const item = await screen.findByTestId(testId);
  await waitFor(() => expect(item).toBeVisible());
  await userEvent.click(item);
}

/** The Perlu cetak ulang box — in the strip on a desktop, in the bottom sheet behind Filter on a phone. */
async function reprintFilter(canvasElement: HTMLElement) {
  const open = within(canvasElement).queryByTestId("warehouse-orders-filters-open");
  if (open) await userEvent.click(open);
  const filter = await screen.findByTestId("warehouse-orders-reprint-filter");
  await waitFor(() => expect(filter).toBeVisible());
  return filter;
}

// THE BADGE AMONG THE ROWS — on the two orders whose resi or label changed after their print, beside the status on the
// same line (a cell is at most two lines); the order changed before its print, the one never printed and the one printed
// and never changed carry none.
export const Default: Story = {
  name: "The badge among the rows",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, REPRINT.confirmed);

    await waitFor(() => expect(badged(canvasElement)).toEqual(MARKED));
    for (const id of UNMARKED) await rowOf(canvasElement, id);
    const badge = canvas.getByTestId(`order-reprint-label-${REPRINT.confirmed}`);
    await expect(badge).toHaveTextContent("Reprint label");
    await expect(badge).toHaveAttribute(
      "title",
      "The seller changed the tracking number or the label after it was printed — print it again.",
    );

    if (canvas.queryByTestId("pick-queue-table")) {
      const row = canvas.getByTestId(`pick-queue-row-${REPRINT.confirmed}`);
      const inRow = within(row).getByTestId(`order-reprint-label-${REPRINT.confirmed}`);
      const status = inRow.parentElement!.firstElementChild!;
      await expect(Math.abs(status.getBoundingClientRect().top - inRow.getBoundingClientRect().top)).toBeLessThan(4);
    }
  },
};

// ON A PHONE the badge is a line of its own in the block, under the status line — the blocks still fit the screen.
export const Phone: Story = {
  name: "Phone 390",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(window.innerWidth).toBe(390);
    await canvas.findByTestId(`pick-queue-block-${REPRINT.confirmed}`, {}, { timeout: 4000 });

    await waitFor(() => expect(badged(canvasElement)).toEqual(MARKED));
    const block = canvas.getByTestId(`pick-queue-block-${REPRINT.picked}`);
    await expect(within(block).getByTestId(`order-reprint-label-${REPRINT.picked}`)).toBeVisible();
    await fitsTheScreen(canvasElement);
  },
};

// PERLU CETAK ULANG — the list's filter: only the marked orders, narrowed by the SERVER (OrderListFilter.reprint_label),
// so the tab counts follow it and the crew can tick them all and print with one Cetak Resi. It lives in the address
// (a-lists-filters-live-in-the-url), the strip counts it, and Clear takes it off.
export const NeedsReprintFilter: Story = {
  name: "Needs reprint filter",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, REPRINT.neverPrinted);
    // Dikonfirmasi counts 103 AND 104 (and any other) before the filter.
    await waitFor(() => expect(Number(canvas.getByTestId("pick-tab-count-confirm").textContent)).toBeGreaterThan(1));

    const filter = await reprintFilter(canvasElement);
    await userEvent.click(within(filter).getByText("Needs reprint"));
    // The strip counts it as a filter — its Clear is on screen.
    await waitFor(() => expect(screen.getAllByTestId("warehouse-orders-filters-clear").length).toBeGreaterThan(0));
    const done = screen.queryByTestId("warehouse-orders-filters-done");
    if (done) await userEvent.click(done);

    for (const id of UNMARKED) {
      await waitFor(() =>
        expect(canvas.queryByTestId(`pick-queue-row-${id}`) ?? canvas.queryByTestId(`pick-queue-block-${id}`)).toBeNull(),
      );
    }
    await waitFor(() => expect(badged(canvasElement)).toEqual(MARKED));
    // The tabs count the marked only — one Dikonfirmasi (103), one Sudah diambil (105).
    await waitFor(() => expect(canvas.getByTestId("pick-tab-count-confirm")).toHaveTextContent(/^1$/));
    await expect(canvas.getByTestId("pick-tab-count-picked")).toHaveTextContent(/^1$/);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("reprint=1"));

    // Clear — every order back, and the address without it.
    await userEvent.click(screen.getAllByTestId("warehouse-orders-filters-clear")[0]!);
    await rowOf(canvasElement, REPRINT.neverPrinted);
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("reprint"));
  },
};

// ?reprint=1 OPENS THE LIST FILTERED — Back from an order, or a refresh, keeps it: the box ticked, the marked rows only.
export const OpensFiltered: Story = {
  name: "?reprint=1 opens it filtered",
  render: () => <AtAllFiltered />,
  play: async ({ canvasElement }) => {
    await rowOf(canvasElement, REPRINT.confirmed);
    await waitFor(() => expect(badged(canvasElement)).toEqual(MARKED));
    await expect(within(canvasElement).queryByTestId(`pick-queue-row-${REPRINT.neverPrinted}`)).toBeNull();

    const filter = await reprintFilter(canvasElement);
    await expect(filter).toHaveAttribute("data-state", "checked");
  },
};

// A ROW'S PRINT LABEL CLEARS IT — the print page marks the order (Pages/Warehouse/PrintReceipts/ReprintLabel), Print records
// the print (OrderLabels `record_print`), and back on the list its badge is gone; 105, not printed, keeps its own.
export const PrintLabelClearsTheBadge: Story = {
  name: "Print Label clears the badge",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const id = REPRINT.confirmed;
    await rowOf(canvasElement, id);
    await waitFor(() => expect(badged(canvasElement)).toEqual(MARKED));

    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${id}`));
    const item = await screen.findByTestId(`pick-queue-print-${id}`);
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);

    await waitFor(() => expect(canvas.getByTestId(`print-receipts-reprint-${id}`)).toHaveTextContent("Reprint label"), {
      timeout: 4000,
    });
    await expect(canvas.getByTestId("print-receipts-list-line")).toHaveTextContent("1 to reprint");

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(canvas.getByTestId(`print-receipts-label-${id}`)).toHaveAttribute("data-label", "printed"));
    await waitFor(() => expect(canvas.queryByTestId(`print-receipts-reprint-${id}`)).toBeNull());
    await expect(reprintLabelScenario.recorded).toEqual([[id]]);

    await userEvent.click(canvas.getByTestId("print-receipts-back"));
    await rowOf(canvasElement, REPRINT.picked);
    await waitFor(() => expect(badged(canvasElement)).toEqual([String(REPRINT.picked)]));
  },
};

// THE HANDOVER SCAN KEEPS A MARKED PARCEL BACK (a-parcel-marked-for-reprint-is-not-handed-over): 105 is Sudah diambil but
// its label changed after the print — *Reprint the label first*, the wrong sound, no move asked; 111, picked and
// unmarked, is handed over at once.
export const HandoverRefusesAMarkedParcel: Story = {
  name: "Handover scan refuses a marked parcel",
  play: async ({ canvasElement }) => {
    await rowOf(canvasElement, REPRINT.picked);
    await headerAction(canvasElement, "warehouse-orders-handover");
    const dialog = within(await screen.findByTestId("handover-dialog"));

    await userEvent.type(dialog.getByTestId("handover-scan"), `${resiOf(REPRINT.picked)}{Enter}`, { delay: 10 });
    const entry = await dialog.findByTestId(`handover-entry-${resiOf(REPRINT.picked)}`);
    await waitFor(() => expect(entry).toHaveAttribute("data-state", "reprint"));
    await expect(entry).toHaveTextContent("Reprint the label first");
    await expect(dialog.getByTestId(`handover-reprint-${resiOf(REPRINT.picked)}`)).toHaveTextContent(
      `Order #${REPRINT.picked}: its label changed after it was printed`,
    );
    await expect(statusChangeScenario.calls).toHaveLength(0);

    await userEvent.type(dialog.getByTestId("handover-scan"), `${resiOf(111n)}{Enter}`, { delay: 10 });
    await waitFor(() => expect(dialog.getByTestId(`handover-entry-${resiOf(111n)}`)).toHaveAttribute("data-state", "handedOver"));
    await expect(statusChangeScenario.calls.at(-1)).toEqual({ teamId: WAREHOUSE, orderIds: [111n], to: OrderStatus.SHIPPING });
  },
};

// THE BAR'S SERAH KURIR — another door to the same move: 105 and 111 ticked on Sudah diambil, one move for both; the
// server refuses 105 in its own words and moves 111, and the toast names why 105 stayed.
export const TheBarsHandoverRefusesIt: Story = {
  name: "The bar's Serah Kurir refuses a marked parcel",
  render: () => <AtPicked />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, REPRINT.picked);
    await rowOf(canvasElement, 111n);

    await userEvent.click(canvas.getByTestId(`pick-queue-select-${REPRINT.picked}`));
    await userEvent.click(canvas.getByTestId("pick-queue-select-111"));
    await userEvent.click(canvas.getByTestId("pick-queue-bulk-handover"));

    // One move for both, in the list's order (newest first).
    await waitFor(() => expect(statusChangeScenario.calls).toHaveLength(1));
    const [call] = statusChangeScenario.calls;
    await expect({ ...call, orderIds: call!.orderIds.map(String).sort() }).toEqual({
      teamId: WAREHOUSE,
      orderIds: [String(REPRINT.picked), "111"],
      to: OrderStatus.SHIPPING,
    });
    await expect(
      await screen.findByText(new RegExp(`#${REPRINT.picked}: the label changed after it was printed — print the new label first`)),
    ).toBeVisible();
  },
};
