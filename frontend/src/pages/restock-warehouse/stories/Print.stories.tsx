import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { marker, markerWithSearch, routedPage } from "../../../../.storybook/pageStory";
import { restockRequestService } from "../../../../.storybook/restockStub";
import { RestockWarehousePage } from "../index";
import { WAREHOUSE_META, loaded } from "./kit";

// RESTOCK WAREHOUSE — TICKED, THEN PRINTED AT ONCE (owner: *"listnya ada cekbox dan bisa cetak sekaligus yang
// dicheck"*, the-list-prints-the-ticked-restocks). The page's stories are grouped by the part of the screen they are
// about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.
//
// Every date (`?range=all`), so the queue's whole history is on the page: 502 arrived, 503 and 507 accepted — the three
// with labels — and 501, 506 on their way, 504 lost, 505 cancelled, whose boxes are there and disabled.

const AllDates = routedPage(
  [
    { path: "/inventories/restock", element: <RestockWarehousePage /> },
    markerWithSearch("/inventories/restock/labels", "at-restock-labels"),
    marker("/inventories/restock/:requestId", "at-restock-detail"),
  ],
  "/inventories/restock?range=all",
);

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouse/Print",
  ...WAREHOUSE_META,
  component: AllDates,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const box = (canvas: ReturnType<typeof within>, id: string) =>
  canvas.getByTestId(`restock-pick-${id}`).querySelector("input")!;

// Only what has labels can be ticked; ticking opens nothing; two ticked print as one run, in the order ticked.
export const TickAndPrint: Story = {
  name: "Tick and print",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const id of ["502", "503", "507"]) await expect(box(canvas, id)).toBeEnabled();
    for (const id of ["501", "504", "505", "506"]) await expect(box(canvas, id)).toBeDisabled();
    await expect(canvas.queryByTestId("restock-print-picked")).toBeNull();

    await userEvent.click(box(canvas, "503"));
    await userEvent.click(box(canvas, "502"));
    // A tick is not a click on the row — the restock did not open.
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();

    const print = await canvas.findByTestId("restock-print-picked");
    await expect(print).toHaveTextContent("Print 2 Restocks");
    await userEvent.click(print);
    await canvas.findByTestId("at-restock-labels");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?ids=503,502");
  },
};

// The header's box ticks every restock on the page that has labels; one un-ticked leaves it a dash; ✕ clears them all.
export const TickEveryOneOnThePage: Story = {
  name: "Tick all on the page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const all = canvas.getByTestId("restock-pick-all");

    await userEvent.click(all.querySelector("input")!);
    await waitFor(() => expect(canvas.getByTestId("restock-print-picked")).toHaveTextContent("Print 3 Restocks"));
    await expect(all).toHaveAttribute("data-state", "checked");
    await expect(box(canvas, "501")).not.toBeChecked();

    await userEvent.click(box(canvas, "507"));
    await waitFor(() => expect(canvas.getByTestId("restock-print-picked")).toHaveTextContent("Print 2 Restocks"));
    await expect(all).toHaveAttribute("data-state", "indeterminate");

    await userEvent.click(canvas.getByTestId("restock-pick-clear"));
    await waitFor(() => expect(canvas.queryByTestId("restock-print-picked")).toBeNull());
    await expect(all).toHaveAttribute("data-state", "unchecked");
  },
};

// AT MOST 50 A PRINT (at-most-fifty-restocks-a-print) — with 50 more boxes at the door, the head's box ticks a page of
// 20, then 20, then only the 10 that fit; every box not ticked is then off, the line under the title says why, and the
// print takes 50.
export const AtMostFifty: Story = {
  name: "At most 50",
  beforeEach: async () => {
    for (let i = 0; i < 50; i++) {
      const { request } = await restockRequestService.restockRequestCreate!(
        {
          teamId: 12n,
          warehouseId: 11n,
          receipt: `JNE-LIMIT-${i}`,
          receiptFile: "",
          shipmentId: 91n,
          invoiceRefId: "",
          financeAccountId: 1301n,
          shipmentCost: 0,
          note: "",
          items: [
            { productId: 71n, sku: "SKU-KOPI-250", name: "Kopi Arabika 250g", count: 1n, total: 40000, supplierId: 0n, supplierChannelId: 0n, note: "" },
          ],
        } as never,
        {} as never,
      );
      await restockRequestService.restockRequestArrive!({ teamId: 11n, requestId: request!.id } as never, {} as never);
    }
  },
  play: async ({ canvasElement }) => {
    // The newest first: 557 heads page 1 (the 50 are 508–557), and 501 is on page 3.
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-557", {}, { timeout: 4000 });
    const head = () => canvas.getByTestId("restock-pick-all").querySelector("input")!;
    const nextPage = () => userEvent.click(canvas.getByTestId("restock-inbound-pager-next"));

    await userEvent.click(head());
    await waitFor(() => expect(canvas.getByTestId("restock-print-picked")).toHaveTextContent("Print 20 Restocks"));
    await nextPage();
    await waitFor(() => expect(head()).not.toBeChecked());
    await userEvent.click(head());
    await waitFor(() => expect(canvas.getByTestId("restock-print-picked")).toHaveTextContent("Print 40 Restocks"));
    await nextPage();
    await waitFor(() => expect(head()).not.toBeChecked());
    await userEvent.click(head());
    await waitFor(() => expect(canvas.getByTestId("restock-print-picked")).toHaveTextContent("Print 50 Restocks"));

    // Full: what is not ticked cannot be — 507 and 503 on this page — and the line says why.
    await expect(canvas.getByTestId("restock-pick-full")).toHaveTextContent("At most 50 restocks a print");
    await expect(box(canvas, "507")).toBeDisabled();
    await expect(box(canvas, "503")).toBeDisabled();
  },
};

// A PHONE — the box leads each block, and Cetak is the header's icon (a-phone-header-action-is-an-icon).
export const TickOnAPhone: Story = {
  name: "Tick on a phone",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(box(canvas, "502"));
    const print = await canvas.findByTestId("restock-print-picked");
    await expect(print).toHaveAccessibleName("Print 1 Restock");
    await userEvent.click(print);
    await canvas.findByTestId("at-restock-labels");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("?ids=502");
  },
};
