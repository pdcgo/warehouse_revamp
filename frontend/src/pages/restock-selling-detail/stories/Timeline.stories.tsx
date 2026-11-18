import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { patchRestock } from "../../../../.storybook/restockStub";
import { RestockLogChangeField as F, RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { editLinesOf502ForStory } from "../../../features/restock/storyTrail";
import { At502, SELLING_DETAIL_META, loaded, openTab, trailRows } from "./kit";

// RESTOCK SELLING DETAIL — Riwayat — the trail, its edit rows, and how its line runs.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Timeline",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE TIMELINE LINES UP (the-timeline-is-centred-and-lines-up) — each step's icon at the middle of its step, not its top;
// every person one width, so the rule beside them runs straight down; and the line runs from the first icon's centre to
// the last's, unbroken — not above the first, not short of the last (owner: *"garis riwayatnya masih belum ngikut"*).
export const TheTimelineLinesUp: Story = {
  name: "Lines up",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await waitFor(() => expect(trailRows(canvasElement).length).toBeGreaterThanOrEqual(3));
    const steps = trailRows(canvasElement);

    const widths = steps.map((step) => step.querySelector<HTMLElement>("[data-testid$='-by']")!.getBoundingClientRect().width);
    await expect(new Set(widths.map(Math.round)).size).toBe(1);

    for (const step of steps) {
      const indicator = step.querySelector<HTMLElement>(".chakra-timeline__indicator")!.getBoundingClientRect();
      const content = step.querySelector<HTMLElement>(".chakra-timeline__content")!;
      const box = content.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(content).paddingBottom);
      const middle = box.top + (box.height - gap) / 2;
      await expect(Math.abs(indicator.top + indicator.height / 2 - middle)).toBeLessThan(3);
    }

    // The line: every icon of the trail (the awaiting step's too), and every piece of line behind them.
    const timeline = canvasElement.querySelector<HTMLElement>("[data-testid='restock-detail-timeline']")!;
    const centres = [...timeline.querySelectorAll<HTMLElement>(".chakra-timeline__indicator")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const pieces = [...timeline.querySelectorAll<HTMLElement>(".chakra-timeline__separator")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .sort((a, b) => a.top - b.top);
    await expect(Math.abs(pieces[0]!.top - centres[0]!)).toBeLessThan(2);
    await expect(Math.abs(pieces.at(-1)!.bottom - centres.at(-1)!)).toBeLessThan(2);
    for (let i = 1; i < pieces.length; i++) {
      await expect(Math.abs(pieces[i]!.top - pieces[i - 1]!.bottom)).toBeLessThan(2);
    }
  },
};

// The server's bare "edited" is not shown on an edit's row — it says nothing the row's title does not. 501 is given the
// row the server writes today: an edit, its description the one word.
export const ABareEditSaysNoMore: Story = {
  name: "A bare edit",
  beforeEach: () =>
    patchRestock(501n, {
      logs: [
        { id: 1n, fromStatus: RestockRequestStatus.UNSPECIFIED, toStatus: RestockRequestStatus.ONGOING, actorUserId: 61n, description: "created", atUnix: 1_790_000_000n },
        { id: 2n, fromStatus: RestockRequestStatus.ONGOING, toStatus: RestockRequestStatus.ONGOING, actorUserId: 61n, description: "edited", atUnix: 1_790_003_600n },
      ],
    }),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const edit = canvas.getByTestId("restock-timeline-2");

    await expect(edit).toHaveAttribute("data-kind", "edit");
    await expect(within(edit).queryByTestId("restock-timeline-2-description")).toBeNull();
  },
};

// edits-are-in-the-same-trail — 502's trail: raised, signed for, then the selling team's edit (status unchanged, the
// change in its description), and a waiting step at the end.
export const TheTrailShowsTheEdit: Story = {
  name: "Shows the edit",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "timeline");

    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(3));
    await expect(trailRows(canvasElement).map((row) => row.dataset.kind)).toEqual(["created", "status", "edit"]);

    const edit = trailRows(canvasElement)[2]!;
    await expect(edit).toHaveTextContent("10 → 12");
    await expect(edit).toHaveTextContent("Edited");
    // The status move is drawn on the status row, not on the edit — an edit keeps its status.
    await expect(within(trailRows(canvasElement)[1]!).getByTestId("restock-timeline-2-move")).toBeVisible();
    await waitFor(() => expect(within(edit).getByTestId("restock-timeline-3-by")).toHaveTextContent("Ani"));
    await expect(canvas.getByTestId("restock-timeline-awaiting")).toBeVisible();
  },
};

// WHAT AN EDIT CHANGED (edits-are-in-the-same-trail) — 502's edit names the line and what moved on it, *Kopi Arabika
// 250g · 10 → 12 pcs · “extra stock …”*, under the row; the bare "edited" beside it is not shown, and the Riwayat carries
// no pending mark any more.
export const TheEditSaysWhatChanged: Story = {
  name: "The edit says what changed",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const edit = await canvas.findByTestId("restock-timeline-3");

    await expect(within(edit).getByTestId("restock-timeline-3-change-line-71")).toHaveTextContent(
      "Kopi Arabika 250g · 10 → 12 pcs · “extra stock — 2 bonus dari supplier”",
    );
    await expect(within(edit).queryByTestId("restock-timeline-3-description")).toBeNull();
    await expect(
      within(canvas.getByTestId("restock-detail-timeline-section")).queryByTestId("not-implemented-trailChanges"),
    ).toBeNull();
  },
};

// AN EDIT MADE NOW is in the trail as the stub saves it — the server's rule: Beras 5 → 6, and Teh Melati added at the
// door, naming its total and its supplier (a-line-added-after-arrival-names-its-supplier) and the note it needs.
export const AnEditMadeNowSaysWhatChanged: Story = {
  name: "An edit made now",
  beforeEach: editLinesOf502ForStory,
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(4));
    const edit = trailRows(canvasElement)[3]!;

    await expect(edit).toHaveAttribute("data-kind", "edit");
    await expect(within(edit).getByTestId("restock-timeline-4-change-line-74")).toHaveTextContent("Beras Pandan Wangi 5kg · 5 → 6 pcs");
    const added = within(edit).getByTestId("restock-timeline-4-change-line-72");
    await expect(added).toHaveAttribute("data-field", "line_added");
    await waitFor(() => expect(added).toHaveTextContent(/^Added Teh Melati 100g × 3 · Rp\s?45\.000 · supplier PT Sumber Makmur · “came in the box”$/));
    // Only what moved: the Kopi line, untouched, is not said.
    await expect(within(edit).queryByTestId("restock-timeline-4-change-line-71")).toBeNull();
    await expect(canvas.queryByTestId("restock-timeline-4-description")).toBeNull();
  },
};

// AN ONGOING EDIT says every field it moved — the restock's own first, each named (the warehouse, the courier, the
// account), then the lines: one changed, two added, one removed. This is the team that bought it, so the purchase's
// figures are said too.
export const AnOngoingEditSaysEveryField: Story = {
  name: "An ongoing edit, every field",
  beforeEach: () =>
    patchRestock(501n, {
      logs: [
        { id: 1n, fromStatus: RestockRequestStatus.UNSPECIFIED, toStatus: RestockRequestStatus.ONGOING, actorUserId: 61n, description: "created", atUnix: 1_790_000_000n },
        {
          id: 2n,
          fromStatus: RestockRequestStatus.ONGOING,
          toStatus: RestockRequestStatus.ONGOING,
          actorUserId: 61n,
          description: "edited",
          atUnix: 1_790_003_600n,
          changes: [
            { field: F.WAREHOUSE, productId: 0n, productName: "", before: "14", after: "11" },
            { field: F.RECEIPT, productId: 0n, productName: "", before: "JNE0000000001", after: "JNE0123456789" },
            { field: F.RECEIPT_FILE, productId: 0n, productName: "", before: "", after: "doc-restock-501-label" },
            { field: F.SHIPMENT, productId: 0n, productName: "", before: "92", after: "91" },
            { field: F.INVOICE_REF, productId: 0n, productName: "", before: "INV/OLD", after: "INV/2026/10/1001" },
            { field: F.FINANCE_ACCOUNT, productId: 0n, productName: "", before: "1302", after: "1301" },
            { field: F.SHIPMENT_COST, productId: 0n, productName: "", before: "15000", after: "20000" },
            { field: F.NOTE, productId: 0n, productName: "", before: "", after: "Untuk promo 10.10" },
            { field: F.LINE_COUNT, productId: 74n, productName: "Beras Pandan Wangi 5kg", before: "8", after: "10" },
            { field: F.LINE_TOTAL, productId: 74n, productName: "Beras Pandan Wangi 5kg", before: "520000", after: "650000" },
            { field: F.LINE_SUPPLIER, productId: 74n, productName: "Beras Pandan Wangi 5kg", before: "32", after: "31" },
            { field: F.LINE_STORE, productId: 74n, productName: "Beras Pandan Wangi 5kg", before: "321", after: "311" },
            { field: F.LINE_ADDED, productId: 71n, productName: "Kopi Arabika 250g", before: "", after: "24" },
            { field: F.LINE_TOTAL, productId: 71n, productName: "Kopi Arabika 250g", before: "", after: "960000" },
            { field: F.LINE_SUPPLIER, productId: 71n, productName: "Kopi Arabika 250g", before: "", after: "33" },
            { field: F.LINE_ADDED, productId: 72n, productName: "Teh Melati 100g", before: "", after: "30" },
            { field: F.LINE_TOTAL, productId: 72n, productName: "Teh Melati 100g", before: "", after: "450000" },
            { field: F.LINE_REMOVED, productId: 73n, productName: "Gula Pasir 1kg", before: "5", after: "" },
          ],
        },
      ],
    }),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const edit = await canvas.findByTestId("restock-timeline-2");
    const line = (key: string) => within(edit).getByTestId(`restock-timeline-2-change-${key}`);

    await waitFor(() => expect(line("warehouse")).toHaveTextContent("Warehouse Gudang Cabang → Gudang Pusat"));
    await expect(line("receipt")).toHaveTextContent("Tracking no. JNE0000000001 → JNE0123456789");
    await expect(line("receipt_file")).toHaveTextContent("Label photo added");
    await waitFor(() => expect(line("shipment")).toHaveTextContent("Courier J&T → JNE"));
    await expect(line("invoice_ref")).toHaveTextContent("Order ID INV/OLD → INV/2026/10/1001");
    await waitFor(() => expect(line("finance_account")).toHaveTextContent("Paid from BCA Gaji → BCA Operasional"));
    await expect(line("shipment_cost")).toHaveTextContent(/^Shipping Rp\s?15\.000 → Rp\s?20\.000$/);
    await expect(line("note")).toHaveTextContent("Note “Untuk promo 10.10”");
    await waitFor(() =>
      expect(line("line-74")).toHaveTextContent(
        /^Beras Pandan Wangi 5kg · 8 → 10 pcs · total Rp\s?520\.000 → Rp\s?650\.000 · supplier CV Cahaya Abadi → PT Sumber Makmur · store cahayaabadi\.co\.id → Sumber Makmur Official$/,
      ),
    );
    await waitFor(() => expect(line("line-71")).toHaveTextContent(/^Added Kopi Arabika 250g × 24 · Rp\s?960\.000 · supplier Toko Grosir Sinar$/));
    await expect(line("line-72")).toHaveTextContent(/^Added Teh Melati 100g × 30 · Rp\s?450\.000$/);
    await expect(line("line-73")).toHaveTextContent("Removed Gula Pasir 1kg × 5");
    await expect(line("line-73")).toHaveAttribute("data-field", "line_removed");

    // The restock's own fields first, then the lines in the order the server wrote them.
    const order = [...within(edit).getByTestId("restock-timeline-2-changes").children].map((el) => el.getAttribute("data-testid"));
    await expect(order).toEqual(
      ["warehouse", "receipt", "receipt_file", "shipment", "invoice_ref", "finance_account", "shipment_cost", "note", "line-74", "line-71", "line-72", "line-73"].map(
        (key) => `restock-timeline-2-change-${key}`,
      ),
    );
  },
};
