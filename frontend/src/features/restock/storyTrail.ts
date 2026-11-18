import { restockClient } from "../../api/clients";

// STORY-ONLY helpers for the trail's edit rows (edits-are-in-the-same-trail). Imported by `*.stories.tsx` only.

/**
 * The selling team edits restock 502 — at the door, so the lines only — THROUGH THE STUB, the way the edit form saves:
 * Beras 5 → 6, and Teh Melati added, 3 pcs for Rp 45.000 from PT Sumber Makmur, with the note a line added at the door
 * needs. The stub writes the edit's row with what changed (editChanges, the server's restockEditChanges), so a story
 * reads the trail as the server would serve it. Call it from a story's `beforeEach` — after preview's reset.
 */
export async function editLinesOf502ForStory() {
  const { request } = await restockClient.restockRequestDetail({ teamId: 12n, requestId: 502n });
  if (!request) throw new Error("no restock 502 in the stub");

  await restockClient.restockRequestUpdate({
    teamId: 12n,
    requestId: 502n,
    warehouseId: request.warehouseId,
    receipt: request.receipt,
    receiptFile: request.receiptFile,
    shipmentId: request.shipmentId,
    invoiceRefId: request.invoiceRefId,
    financeAccountId: request.financeAccountId,
    shipmentCost: request.shipmentCost,
    note: request.note,
    items: [
      ...request.items.map((it) => ({
        productId: it.productId,
        productCode: it.productCode,
        name: it.name,
        count: it.productId === 74n ? 6n : it.count,
        total: it.total,
        supplierId: it.supplierId,
        supplierChannelId: it.supplierChannelId,
        note: it.note,
      })),
      {
        productId: 72n,
        productCode: "SKU-TEH-100",
        name: "Teh Melati 100g",
        count: 3n,
        total: 45000,
        supplierId: 31n,
        supplierChannelId: 0n,
        note: "came in the box",
      },
    ],
  });
}
