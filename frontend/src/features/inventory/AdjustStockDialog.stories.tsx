import { useState } from "react";
import { create } from "@bufbuild/protobuf";
import { Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { reportScenario } from "../../../.storybook/foundRequestStub";
import { inventoryClient } from "../../api/clients";
import { type Product, ProductSchema } from "../../gen/warehouse/product/v1/product_pb";
import { AdjustStockDialog, description } from "./AdjustStockDialog";

// THE ADJUST DIALOG — and its FOUND, which waits for approval (an-adjust-found-waits-for-the-owner-or-admin).
//
// A unit found on a rack names no batch: it is reported through FoundRequestCreate for the warehouse Owner or Admin to
// approve, and the dialog says plainly that nothing changes until then. Damaged and Lost still name their batch.
//
// Gudang Pusat (11): Beras on B-02-1 is free; stock count #15 holds Gula Pasir on A-01-2; Kopi Arabika was never stocked
// here (foundRequestFixtures.ts).

const BERAS = create(ProductSchema, { id: 74n, teamId: 12n, productCode: "SKU-BERAS-5K", name: "Beras Pandan Wangi 5kg" });
const GULA = create(ProductSchema, { id: 73n, teamId: 13n, productCode: "SKU-GULA-1K", name: "Gula Pasir 1kg" });
const KOPI = create(ProductSchema, { id: 71n, teamId: 11n, productCode: "SKU-KOPI-250", name: "Kopi Arabika 250g" });

function Open({
  product,
  fixedBatch,
}: {
  product: Product;
  fixedBatch?: { id: bigint; ready: bigint; source: string; rackIds?: bigint[] };
}) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <AdjustStockDialog
        warehouseId={11n}
        product={product}
        currentOnHand={8n}
        open={open}
        onOpenChange={setOpen}
        fixedBatch={fixedBatch}
      />
      {!open && <Text data-testid="adjust-closed">closed</Text>}
    </>
  );
}

const meta = {
  title: "Features/Inventory/AdjustStockDialog",
  component: AdjustStockDialog,
  parameters: { docs: { description: { component: description } } },
  args: { warehouseId: 11n, product: BERAS, currentOnHand: 8n, open: true, onOpenChange: () => {} },
  render: (args) => <Open product={args.product} fixedBatch={args.fixedBatch} />,
} satisfies Meta<typeof AdjustStockDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// The dialog portals and its RackSelect renders inline, so the option is looked up inside the picker's own root.
async function pickRack(rackId: bigint) {
  const trigger = await screen.findByTestId("rack-select");
  const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
  await userEvent.click(trigger);
  const option = await within(root).findByTestId(`rack-select-option-${rackId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

async function amount(value: string) {
  const el = screen.getByTestId("adjust-amount");
  await userEvent.clear(el);
  await userEvent.type(el, value, { delay: 40 });
}

// The reason is a radio pill, every one on screen (the-adjust-reason-is-a-radio-pill): one click picks it.
async function pickReason(reason: "recount" | "damaged" | "lost" | "found") {
  const option = screen.getByTestId(`adjust-reason-option-${reason}`);
  await userEvent.click(option);
  await waitFor(() => expect(option).toHaveAttribute("data-state", "checked"));
}

async function reportFound(rackId: bigint) {
  await screen.findByTestId("adjust-dialog");
  await pickRack(rackId);
  await pickReason("found");
}

// Found asks for no batch, says nothing changes until the Owner or Admin approves, and sends a request.
export const FoundWaitsForApproval: Story = {
  play: async () => {
    await reportFound(43n);

    // No batch — the approval picks the batches (the oldest loss's, then a minted one).
    await expect(screen.queryByTestId("adjust-batch")).toBeNull();
    const notice = screen.getByTestId("adjust-found-waits");
    // ONE LINE (a-found-waits-in-one-line); what it claims back on approval is its hover.
    await expect(notice).toHaveTextContent(/^Stock changes once another Owner or Admin of the warehouse approves it\.$/);
    await expect(notice).toHaveAttribute("title", expect.stringContaining("oldest open loss"));

    // A found report starts at one unit, not at the rack's on-hand.
    await expect(screen.getByTestId("adjust-amount")).toHaveValue("1");
    await amount("4");
    await userEvent.type(screen.getByTestId("adjust-reason"), "Behind the cartons", { delay: 20 });
    // It has its preview too (owner: *"ditemukan ada pratinjaunya"*) — B-02-1's 2, Found +4, and the total it comes to
    // once approved, since nothing moves until then (the-adjust-preview-shows-its-working).
    await expect(screen.getByTestId("adjust-delta-before")).toHaveTextContent(/^2$/);
    await expect(screen.getByTestId("adjust-delta-reason")).toHaveTextContent(/^\+4$/);
    await expect(screen.getByTestId("adjust-delta-diff")).toHaveTextContent(/^Increased\s*\+4$/);
    await expect(screen.getByTestId("adjust-delta")).toHaveTextContent("Total once approved");
    await expect(screen.getByTestId("adjust-delta-total")).toHaveTextContent(/^6$/);
    // …and its line sits UNDER the preview, not in the form (owner: *"kasih di bawah pratinjau saja"*).
    await expect(notice.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      screen.getByTestId("adjust-delta").getBoundingClientRect().bottom,
    );
    await expect(notice.getBoundingClientRect().left).toBeGreaterThan(
      screen.getByTestId("adjust-amount").getBoundingClientRect().right,
    );

    const submit = screen.getByTestId("submit-adjust");
    await expect(submit).toHaveTextContent("Send for Approval");
    await userEvent.click(submit);

    await screen.findByTestId("adjust-closed");
    // FoundRequestCreate — the one door; StockAdjust refuses FOUND.
    await expect(reportScenario.last).toEqual({ productId: 74n, rackId: 43n, quantity: 4n, note: "Behind the cartons" });
  },
};

// A PRODUCT ITS TEAM NEVER HAD HERE IS REFUSED AT THE REPORT (a-found-never-stocked-here-is-refused-at-the-report): the
// server's words name it and say how it comes in, and nothing is sent.
export const NeverStockedHereIsRefused: Story = {
  args: { product: KOPI },
  play: async () => {
    await reportFound(43n);
    await userEvent.click(screen.getByTestId("submit-adjust"));

    const error = await screen.findByTestId("adjust-error");
    await expect(error).toHaveTextContent("Kopi Arabika 250g (SKU-KOPI-250) was never stocked here");
    await expect(error).toHaveTextContent("bring it in by restock");
    await expect(screen.queryByTestId("adjust-closed")).toBeNull();
  },
};

// Found alone names no batch: Damaged still names the batch the units are written off from.
export const DamagedStillNamesItsBatch: Story = {
  play: async () => {
    await screen.findByTestId("adjust-dialog");
    await pickRack(43n);
    await pickReason("damaged");

    await expect(await screen.findByTestId("adjust-batch")).toBeInTheDocument();
    await expect(screen.queryByTestId("adjust-found-waits")).toBeNull();
    await expect(screen.getByTestId("submit-adjust")).toHaveTextContent("Adjust");

    // The batch is picked by its OWN number, searched (a-batch-is-picked-by-its-own-number) — and Adjust waits for it.
    await expect(screen.getByTestId("submit-adjust")).toBeDisabled();
    const input = screen.getByTestId("adjust-batch");
    await userEvent.click(input);
    await userEvent.type(input, "7", { delay: 30 });
    const option = await screen.findByTestId("adjust-batch-option-7");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await waitFor(() => expect(input).toHaveValue("#7 · 3 ready"));
    await amount("1");
    await expect(screen.getByTestId("submit-adjust")).toBeEnabled();
  },
};

// IT LEADS WITH WHAT IT ADJUSTS (owner: *"dari atas, kasih aja info produk, tersedia berapa unit keseluruhan"*,
// the-adjust-dialog-leads-with-what-it-adjusts) — on a product's page the product and its units here, no batch.
export const ItLeadsWithTheProduct: Story = {
  name: "It leads with the product",
  play: async () => {
    const subject = within(await screen.findByTestId("adjust-subject"));
    await expect(subject.getByText("Beras Pandan Wangi 5kg")).toBeVisible();
    await expect(subject.getByText("SKU-BERAS-5K")).toBeVisible();
    await expect(subject.getByText("Available")).toBeVisible();
    await expect(subject.getByTestId("adjust-available")).toHaveTextContent("8 units");
    await expect(screen.queryByTestId("adjust-batch-fixed")).toBeNull();
  },
};

// OPENED FROM A BATCH'S PAGE, IT IS THAT BATCH (owner: *"kenapa di sesuaikan stok harus pilih batch lagi?"*,
// the-batch-page-adjusts-its-own-batch; *"kalau di batch seperti sekarang, tampilkan batchnya dan tersisa berapa unit"*,
// the-adjust-dialog-leads-with-what-it-adjusts) — said at the top with its units left, its racks the only ones offered,
// and Damaged opens nothing: the page's batch is the one sent.
export const ABatchPageAdjustsItsOwnBatch: Story = {
  name: "A batch page's own batch",
  args: { fixedBatch: { id: 7n, ready: 3n, source: "Restock #503", rackIds: [43n] } },
  beforeEach: () => {
    const spy = spyOn(inventoryClient, "stockAdjust");

    return () => spy.mockRestore();
  },
  play: async () => {
    const fixed = await screen.findByTestId("adjust-batch-fixed");
    await expect(within(screen.getByTestId("adjust-subject")).getByTestId("adjust-batch-fixed")).toBe(fixed);
    await expect(fixed).toHaveTextContent("Batch #7");
    await expect(fixed).toHaveTextContent("Restock #503");
    await expect(fixed).toHaveTextContent("Left");
    await expect(screen.getByTestId("adjust-batch-left")).toHaveTextContent("3 units");

    // Only the batch's racks (owner: *"racknya jangan tampil semua, sesuai dengan rack batchnya"*).
    const trigger = screen.getByTestId("rack-select");
    const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
    await userEvent.click(trigger);
    await waitFor(() => expect(within(root).getByTestId("rack-select-option-43")).toBeVisible());
    await expect(within(root).queryByTestId("rack-select-option-41")).toBeNull();
    await expect(within(root).queryByTestId("rack-select-option-42")).toBeNull();
    await userEvent.click(within(root).getByTestId("rack-select-option-43"));

    // Damaged opens nothing — no batch to pick.
    await pickReason("damaged");
    await expect(screen.queryByTestId("adjust-batch")).toBeNull();

    await amount("1");
    await expect(screen.getByTestId("submit-adjust")).toBeEnabled();
    await userEvent.click(screen.getByTestId("submit-adjust"));
    await screen.findByTestId("adjust-closed");
    const calls = (inventoryClient.stockAdjust as unknown as { mock: { calls: [{ batchId: bigint; quantity: bigint }][] } })
      .mock.calls;
    await expect(calls.at(-1)?.[0]).toMatchObject({ batchId: 7n, quantity: 1n });
  },
};

// From a batch's page a reason opens nothing but Found's line (owner: *"alasan sudah tidak buka keterangan apapun,
// kecuali ditemukan"*).
export const ABatchPageReasonsOpenNothingButFound: Story = {
  name: "A batch page's reasons open nothing but Found",
  args: { fixedBatch: { id: 7n, ready: 3n, source: "Restock #503", rackIds: [43n] } },
  play: async () => {
    await screen.findByTestId("adjust-dialog");
    for (const reason of ["recount", "damaged", "lost"] as const) {
      await pickReason(reason);
      await expect(screen.queryByTestId("adjust-batch")).toBeNull();
      await expect(screen.queryByTestId("adjust-found-waits")).toBeNull();
    }
    await pickReason("found");
    await expect(screen.getByTestId("adjust-found-waits")).toBeVisible();
  },
};

// THE PREVIEW IS A RECEIPT AT THE FORM'S RIGHT (owner: *"pratinjau kasih di kanannya … tidak perlu perhitungan kasih aja
// Hilang/rusak/dsb, lalu bawahnya selisih ada totalnya"*, the-adjust-preview-shows-its-working) — on screen from the start,
// dashes until a rack is picked; then B-02-1's 2 Beras: a recount up, the same, and down; Damaged as its units out.
export const ThePreviewShowsItsWorking: Story = {
  name: "The preview shows its working",
  play: async () => {
    await screen.findByTestId("adjust-dialog");

    // Beside the form, where there is room.
    const preview = screen.getByTestId("adjust-delta");
    await expect(screen.getByTestId("adjust-layout")).toHaveAttribute("data-layout", "side");
    await expect(preview.getBoundingClientRect().left).toBeGreaterThan(
      screen.getByTestId("adjust-amount").getBoundingClientRect().right,
    );
    await expect(within(preview).getByText("Preview")).toBeVisible();
    await expect(screen.getByTestId("adjust-delta-before")).toHaveTextContent(/^—$/);
    await expect(screen.getByTestId("adjust-delta-total")).toHaveTextContent(/^—$/);

    await pickRack(43n);
    await amount("5");
    await expect(screen.getByTestId("adjust-delta-before")).toHaveTextContent(/^2$/);
    // No calculation — the reason itself, and what it does (a recount: the figure counted).
    await expect(preview).toHaveTextContent("Recount");
    await expect(screen.getByTestId("adjust-delta-reason")).toHaveTextContent(/^5$/);
    await expect(screen.getByTestId("adjust-delta-diff")).toHaveTextContent(/^Increased\s*\+3$/);
    await expect(screen.getByTestId("adjust-delta-badge")).toHaveAttribute("data-direction", "up");
    await expect(screen.getByTestId("adjust-delta-total")).toHaveTextContent(/^5$/);

    await amount("2");
    await expect(screen.getByTestId("adjust-delta-diff")).toHaveTextContent(/^Unchanged\s*0$/);
    await expect(screen.getByTestId("adjust-delta-badge")).toHaveAttribute("data-direction", "same");
    await expect(screen.getByTestId("adjust-delta-total")).toHaveTextContent(/^2$/);

    await amount("1");
    await expect(screen.getByTestId("adjust-delta-diff")).toHaveTextContent(/^Decreased\s*−1$/);
    await expect(screen.getByTestId("adjust-delta-badge")).toHaveAttribute("data-direction", "down");

    // Damaged — its units out, then the difference and the total under it.
    await pickReason("damaged");
    const input = screen.getByTestId("adjust-batch");
    await userEvent.click(input);
    const option = await screen.findByTestId("adjust-batch-option-7");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await amount("1");
    await expect(preview).toHaveTextContent("Damaged");
    await expect(screen.getByTestId("adjust-delta-reason")).toHaveTextContent(/^−1$/);
    await expect(screen.getByTestId("adjust-delta-diff")).toHaveTextContent(/^Decreased\s*−1$/);
    await expect(screen.getByTestId("adjust-delta-total")).toHaveTextContent(/^1$/);
  },
};

// ON A PHONE, A DRAWER FROM THE BOTTOM (owner: *"sesuaikan stok juga pakai drawer di bawah"*,
// the-adjust-dialog-is-a-sheet-on-a-phone) — its foot on the screen's, the screen's width; the preview after the note, one
// column (the-adjust-preview-shows-its-working); Batal and Sesuaikan two equal halves under the thumb.
export const OnAPhoneThePreviewIsUnderTheNote: Story = {
  name: "On a phone, a sheet with the preview under the note",
  globals: { viewport: { value: "mobile1" } },
  play: async () => {
    const sheet = await screen.findByTestId("adjust-dialog");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(sheet).toHaveAttribute("role", "dialog");
    await expect(Math.round(sheet.getBoundingClientRect().bottom)).toBe(window.innerHeight);
    await expect(Math.round(sheet.getBoundingClientRect().width)).toBe(window.innerWidth);

    await expect(screen.getByTestId("adjust-layout")).toHaveAttribute("data-layout", "stacked");
    await expect(screen.getByTestId("adjust-delta").getBoundingClientRect().top).toBeGreaterThan(
      screen.getByTestId("adjust-reason").getBoundingClientRect().bottom,
    );

    const cancel = screen.getByTestId("adjust-cancel").getBoundingClientRect();
    const submit = screen.getByTestId("submit-adjust").getBoundingClientRect();
    await expect(Math.abs(cancel.width - submit.width)).toBeLessThan(2);

    // Batal closes it.
    await userEvent.click(screen.getByTestId("adjust-cancel"));
    await screen.findByTestId("adjust-closed");
  },
};

// A stock count holding the product on the rack refuses the report like every adjustment
// (a-lock-stops-sales-and-cancels-too) — nothing is sent for approval, and the dialog says which count.
export const ACountedRackRefusesTheFound: Story = {
  args: { product: GULA },
  play: async () => {
    await reportFound(42n);
    await amount("2");
    await userEvent.click(screen.getByTestId("submit-adjust"));

    await expect(await screen.findByTestId("adjust-error")).toHaveTextContent("count #15");
    await expect(reportScenario.last?.productId).toBe(73n);
    await expect(screen.queryByTestId("adjust-closed")).toBeNull();
  },
};

// THE REASON IS A RADIO PILL, THE NOTE A TEXTAREA (owner: *"aku ingin itu jadi pilihan radio kalau masih sedikit"*,
// the-adjust-reason-is-a-radio-pill; *"catatan textarea"*, the-adjust-dialog-picks-with-chakra-controls) — the four
// reasons on screen at once, Recount chosen as it opens, one click to change; no list to open, no native <select>.
export const ReasonAndNote: Story = {
  name: "Reason and note",
  play: async () => {
    await screen.findByTestId("adjust-dialog");
    const group = screen.getByTestId("adjust-reason-type");

    await expect(within(group).getAllByRole("radio")).toHaveLength(4);
    for (const reason of ["recount", "damaged", "lost", "found"]) {
      await expect(screen.getByTestId(`adjust-reason-option-${reason}`)).toBeVisible();
    }
    await expect(screen.getByTestId("adjust-reason-option-recount")).toHaveAttribute("data-state", "checked");
    await expect(screen.queryByRole("combobox", { name: "Reason" })).toBeNull();

    // One click changes it, and the form follows — Lost asks for its batch.
    await pickReason("lost");
    await expect(await screen.findByTestId("adjust-batch")).toBeInTheDocument();

    await expect(screen.getByTestId("adjust-reason").tagName).toBe("TEXTAREA");
  },
};

// The note says where its limit is — FoundRequestCreateRequest.note's 200 (a-limited-field-shows-its-count).
export const TheNoteShowsItsLimit: Story = {
  play: async () => {
    await reportFound(43n);
    await userEvent.type(screen.getByTestId("adjust-reason"), "Rak bawah", { delay: 20 });
    await expect(screen.getByTestId("adjust-reason-count")).toHaveTextContent("9/200");
  },
};
