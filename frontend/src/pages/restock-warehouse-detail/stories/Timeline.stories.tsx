import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { patchRestock } from "../../../../.storybook/restockStub";
import { restockFixture } from "../../../../.storybook/restockFixtures";
import { RestockLogChangeField as F, RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { editLinesOf502ForStory } from "../../../features/restock/storyTrail";
import { At502, WAREHOUSE_DETAIL_META, loaded, trailRows } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the trail, the selling team's edits in it.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Timeline",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The selling team's edit is in the warehouse's trail too — the count it is about to accept was changed after the box
// was opened (edits-are-in-the-same-trail).
export const TheTrailShowsTheSellingTeamsEdit: Story = {
  name: "The selling team's edit",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(trailRows(canvasElement).map((row) => row.dataset.kind)).toEqual(["created", "status", "edit"]));
    await expect(trailRows(canvasElement)[2]).toHaveTextContent("10 → 12");
  },
};

// WHAT AN EDIT CHANGED, AS THE WAREHOUSE READS IT (edits-are-in-the-same-trail, the-warehouse-reads-the-box-not-the-
// purchase) — the box's side: a count, a line added at the door with its note. Not the purchase: Teh's price and its
// supplier are left out, as the rest of this page leaves them out. And the Riwayat carries no pending mark any more.
export const TheWarehouseReadsWhatTheEditChanged: Story = {
  name: "What the edit changed",
  beforeEach: editLinesOf502ForStory,
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(4));
    const edit = trailRows(canvasElement)[3]!;

    await expect(within(edit).getByTestId("restock-timeline-4-change-line-74")).toHaveTextContent("Beras Pandan Wangi 5kg · 5 → 6 pcs");
    await expect(within(edit).getByTestId("restock-timeline-4-change-line-72")).toHaveTextContent(/^Added Teh Melati 100g × 3 · “came in the box”$/);
    await expect(edit).not.toHaveTextContent("Rp");
    await expect(edit).not.toHaveTextContent("PT Sumber Makmur");
    await expect(
      within(canvas.getByTestId("restock-detail-timeline-section")).queryByTestId("not-implemented-trailChanges"),
    ).toBeNull();
  },
};

// THE PURCHASE IS NOT THE WAREHOUSE'S (the-warehouse-reads-the-box-not-the-purchase) — an ongoing edit that moved the
// resi and the courier, the Order ID, the paying account, the shipping and a line's price and supplier: the warehouse
// reads the resi and the courier; a line whose only change was its price and supplier is not drawn at all.
export const ThePurchasesChangesAreNotTheWarehouses: Story = {
  name: "Not the purchase's changes",
  beforeEach: () =>
    patchRestock(502n, {
      logs: [
        ...restockFixture(502n).logs,
        {
          id: 4n,
          fromStatus: RestockRequestStatus.ARRIVED,
          toStatus: RestockRequestStatus.ARRIVED,
          actorUserId: 61n,
          description: "edited",
          atUnix: restockFixture(502n).logs[2]!.atUnix + 60n,
          changes: [
            { field: F.RECEIPT, productId: 0n, productName: "", before: "JNT0000000001", after: "JNT9988776655" },
            { field: F.SHIPMENT, productId: 0n, productName: "", before: "91", after: "92" },
            { field: F.INVOICE_REF, productId: 0n, productName: "", before: "INV/OLD", after: "INV/2026/10/0987" },
            { field: F.FINANCE_ACCOUNT, productId: 0n, productName: "", before: "1302", after: "1301" },
            { field: F.SHIPMENT_COST, productId: 0n, productName: "", before: "10000", after: "15000" },
            { field: F.LINE_TOTAL, productId: 74n, productName: "Beras Pandan Wangi 5kg", before: "300000", after: "325000" },
            { field: F.LINE_SUPPLIER, productId: 74n, productName: "Beras Pandan Wangi 5kg", before: "31", after: "32" },
          ],
        },
      ],
    }),
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(4));
    const edit = trailRows(canvasElement)[3]!;

    await expect(within(edit).getByTestId("restock-timeline-4-change-receipt")).toHaveTextContent("Tracking no. JNT0000000001 → JNT9988776655");
    await waitFor(() => expect(within(edit).getByTestId("restock-timeline-4-change-shipment")).toHaveTextContent("Courier JNE → J&T"));
    for (const key of ["invoice_ref", "finance_account", "shipment_cost", "line-74"]) {
      await expect(within(edit).queryByTestId(`restock-timeline-4-change-${key}`)).toBeNull();
    }
    await expect(edit).not.toHaveTextContent("Rp");
  },
};
