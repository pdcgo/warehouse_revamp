import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { REPRINT, reprintLabelScenario, withReprintedOrders } from "../../../../.storybook/reprintLabelScenario";
import { PHONE_VIEWPORTS, fitsTheScreen } from "../../../features/warehouseTransfer/storyPhone";
import { PrintReceiptsPage } from "../../print-receipts/index";
import { PickOrderPage } from "../index";

// CETAK ULANG LABEL on the PICK PAGE (a-changed-label-asks-the-warehouse-to-reprint, accepted as drawn in
// the-reprint-label-prototype-is-accepted) — live: the server's `Order.reprint_label` on OrderDetail. Gudang Pusat (11)
// opens 103 — Dikonfirmasi, its label printed 3 h ago, its resi and label replaced by Toko Melati 1 h ago
// (.storybook/reprintLabelScenario.ts). Under the title: *Cetak ulang label*, why, and *Cetak Resi* — the print page with
// this one order, as a row's ⋯ Print Label opens it (a-rows-print-label-opens-the-print-page). The seller's Edit Resi note
// (old → new) is in the page's Catatan card, read before the walk.
//
//   | story                        | what it pins                                                                 |
//   | ---------------------------- | ---------------------------------------------------------------------------- |
//   | Default                      | the line under the title, the note naming old → new, the item scan unchanged  |
//   | Phone                        | the line wraps inside the 390 px screen                                       |
//   | PickedToo                    | 105, Sudah diambil — the badge until it is reprinted                          |
//   | PrintLabelClearsIt           | the line's Print Label → the print page → Print → back here, the line is gone |
//   | AChangeBeforeThePrintShows…  | 104 changed before its print: nothing                                         |

const Routed = (path: string) =>
  routedPage(
    [
      { path: "/warehouse-orders/:orderId", element: <PickOrderPage /> },
      { path: "/warehouse-orders/print", element: <PrintReceiptsPage /> },
      marker("/warehouse-orders", "at-pick-queue"),
    ],
    path,
  );

const AtConfirmed = Routed(`/warehouse-orders/${REPRINT.confirmed}`);
const AtPicked = Routed(`/warehouse-orders/${REPRINT.picked}`);
const AtChangedBefore = Routed(`/warehouse-orders/${REPRINT.changedBeforeThePrint}`);

const PHONE = { viewport: { value: "phone390" } };

const meta = {
  title: "Pages/Order/PickOrderPage/ReprintLabel",
  component: PickOrderPage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen", viewport: { options: PHONE_VIEWPORTS } },
  beforeEach: () => {
    asTeam(11n)();
    const restore = withReprintedOrders();
    const open = spyOn(window, "open").mockReturnValue(null);

    return () => {
      open.mockRestore();
      restore();
    };
  },
  render: () => <AtConfirmed />,
} satisfies Meta<typeof PickOrderPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("pick-list-table", {}, { timeout: 4000 });
  return canvas;
}

// THE LINE UNDER THE TITLE — the badge, why, and the one click that prints it again; the Catatan card names what changed.
export const Default: Story = {
  name: "Confirmed, label changed after its print",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-reprint-label")).toHaveTextContent("Reprint label"));
    await expect(canvas.getByTestId("pick-reprint-label-line")).toHaveTextContent("Print the new label before packing");
    await expect(canvas.getByTestId("pick-reprint-label-print")).toHaveTextContent("Print Label");
    await expect(canvas.getByTestId("pick-order-notes")).toHaveTextContent("Label: resi-103-lama.pdf → resi-103.pdf");
    // The item scan is the page's as before.
    await expect(canvas.getByTestId(`pick-line-301`)).toBeInTheDocument();
  },
};

// ON A PHONE the line wraps — the badge and the button, the sentence under them — and nothing runs past the edge.
export const Phone: Story = {
  name: "Phone 390",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(390);

    await waitFor(() => expect(canvas.getByTestId("pick-reprint-label-line")).toBeVisible());
    await fitsTheScreen(canvasElement);
  },
};

// SUDAH DIAMBIL TOO — boxed with the old label, the badge says it until it is printed again.
export const PickedToo: Story = {
  name: "Picked, label changed after its print",
  render: () => <AtPicked />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-reprint-label")).toBeVisible());
    await expect(canvas.getByTestId("pick-order-notes")).toHaveTextContent("Label: resi-105-salah.pdf → resi-105.pdf");
  },
};

// THE LINE'S PRINT LABEL — the print page with this one order (marked there too); Print, then Back returns here, and the
// line is gone: the label in the PDF is the new one.
export const PrintLabelClearsIt: Story = {
  name: "Print Label clears it",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const id = REPRINT.confirmed;

    await userEvent.click(await canvas.findByTestId("pick-reprint-label-print"));
    await waitFor(() => expect(canvas.getByTestId(`print-receipts-reprint-${id}`)).toBeVisible(), { timeout: 4000 });
    await expect(canvas.getByTestId("print-receipts-heading")).toHaveTextContent("1 Order");

    await userEvent.click(canvas.getByTestId("print-receipts-print"));
    await waitFor(() => expect(canvas.getByTestId(`print-receipts-label-${id}`)).toHaveAttribute("data-label", "printed"));
    // The print is recorded (OrderLabels `record_print`) for this one order.
    await expect(reprintLabelScenario.recorded).toEqual([[id]]);

    await userEvent.click(canvas.getByTestId("print-receipts-back"));
    await loaded(canvasElement);
    await waitFor(() => expect(canvas.queryByTestId("pick-reprint-label-line")).toBeNull());
  },
};

// A CHANGE BEFORE THE PRINT SHOWS NOTHING — the print took the new label.
export const AChangeBeforeThePrintShowsNothing: Story = {
  name: "Changed before its print → nothing",
  render: () => <AtChangedBefore />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("pick-reprint-label-line")).toBeNull();
  },
};
