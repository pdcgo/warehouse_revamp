import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { asTeam, markerWithSearch, routedPage } from "../../../../.storybook/pageStory";
import { REPRINT, reprintLabelScenario, withReprintedOrders } from "../../../../.storybook/reprintLabelScenario";
import { PHONE_VIEWPORTS, fitsTheScreen } from "../../../features/warehouseTransfer/storyPhone";
import { PrintReceiptsPage } from "../index";
import { UNBOXING_STORAGE_KEY } from "../unboxing";
import { on110AsJnt } from "./kit";

// CETAK ULANG LABEL on the PRINT PAGE (a-changed-label-asks-the-warehouse-to-reprint, accepted as drawn in
// the-reprint-label-prototype-is-accepted; the page is #79's) — live: the server's `OrderPrint.reprint_label`. The orders
// a reprint is made on come here — from the list's Cetak Resi, a row's ⋯ Print Label, or the pick page's line — so the
// page says which of them it is printing AGAIN: the badge under the order's label, and the count on the list line. Print
// RECORDS the print (OrderLabels `record_print`) for every order the PDF includes, so the badge clears everywhere;
// nothing else about the page changes (a reprint keeps its step).
//
// The orders, Gudang Pusat (11)'s: 110 (To confirm, printed, never changed), 103 (Dikonfirmasi — printed, then its resi
// and label replaced), 105 (Sudah diambil — printed, then its label replaced), 101 (To confirm — its resi replaced, never
// printed: nothing).
//
//   | story               | what it pins                                                                        |
//   | ------------------- | ----------------------------------------------------------------------------------- |
//   | Default             | 103 and 105 marked under their label; the list line counts *2 to reprint*            |
//   | PrintClearsTheMarks | one Print — recorded for all four, the marks gone, the two To confirm moved           |
//   | Phone               | the mark in each block, the blocks fit 390 px                                         |

const IDS = [REPRINT.printedUnchanged, REPRINT.confirmed, REPRINT.picked, REPRINT.neverPrinted];

const Routed = routedPage(
  [
    { path: "/warehouse-orders/print", element: <PrintReceiptsPage /> },
    markerWithSearch("/warehouse-orders", "at-warehouse-orders"),
  ],
  `/warehouse-orders/print?ids=${IDS.join(",")}`,
);

const PHONE = { viewport: { value: "phone390" } };

const meta = {
  title: "Pages/Warehouse/PrintReceipts/ReprintLabel",
  component: PrintReceiptsPage,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: () => {
    asTeam(11n)();
    window.localStorage.removeItem(UNBOXING_STORAGE_KEY);
    const restoreEdits = withReprintedOrders();
    const restoreCourier = on110AsJnt();
    const open = spyOn(window, "open").mockReturnValue(null);

    return () => {
      open.mockRestore();
      restoreCourier();
      restoreEdits();
      window.localStorage.removeItem(UNBOXING_STORAGE_KEY);
    };
  },
  render: () => <Routed />,
} satisfies Meta<typeof PrintReceiptsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function page(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("print-receipts-orders", {}, { timeout: 4000 });
  for (const id of IDS) {
    await waitFor(() => expect(canvas.getByTestId(`print-receipts-step-${id}`)).toBeInTheDocument());
  }
  return canvas;
}

const marked = (canvasElement: HTMLElement) =>
  Array.from(canvasElement.querySelectorAll("[data-testid^='print-receipts-reprint-']"))
    .map((el) => el.getAttribute("data-testid")!.replace("print-receipts-reprint-", ""))
    .sort();

// THE ORDERS PRINTED AGAIN ARE SAID SO — under the label, and counted on the list line.
export const Default: Story = {
  name: "The reprints are marked",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);

    await waitFor(() => expect(marked(canvasElement)).toEqual([REPRINT.confirmed, REPRINT.picked].map(String).sort()));
    await expect(canvas.getByTestId("print-receipts-list-line")).toHaveTextContent("4 orders · 2 to confirm · 2 to reprint");
    await expect(canvas.getByTestId(`print-receipts-label-${REPRINT.confirmed}`)).toHaveAttribute("data-label", "attached");
  },
};

// ONE PRINT — the new labels go into the PDF and the marks are gone; the reprints keep their step, the two To confirm
// move (Konfirmasi setelah dicetak, as built).
export const PrintClearsTheMarks: Story = {
  name: "Print clears the marks",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);
    await waitFor(() => expect(marked(canvasElement)).toHaveLength(2));

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(canvas.getByTestId("print-receipts-result")).toBeVisible());
    await waitFor(() => expect(marked(canvasElement)).toEqual([]));
    await expect(canvas.getByTestId(`print-receipts-label-${REPRINT.picked}`)).toHaveAttribute("data-label", "printed");
    await expect(canvas.getByTestId("print-receipts-list-line")).not.toHaveTextContent("to reprint");
    // ONE record, for every order the PDF took — the reprints and the first prints alike.
    await expect(reprintLabelScenario.recorded.map((ids) => ids.map(String).sort())).toEqual([IDS.map(String).sort()]);
  },
};

// ON A PHONE the mark sits under the label in each block.
export const Phone: Story = {
  name: "Phone 390",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);
    await expect(window.innerWidth).toBe(390);

    const block = canvas.getByTestId(`print-receipts-block-${REPRINT.confirmed}`);
    await waitFor(() => expect(within(block).getByTestId(`print-receipts-reprint-${REPRINT.confirmed}`)).toBeVisible());
    await fitsTheScreen(canvasElement);
  },
};
