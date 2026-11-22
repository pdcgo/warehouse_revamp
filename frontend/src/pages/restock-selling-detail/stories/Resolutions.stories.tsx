import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SEED_LOG, settledThenReopenedForStory } from "../../../../.storybook/restockResolutionScenario";
import { TAG } from "../../../../.storybook/restockTagKit";
import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import { asTeam } from "../../../../.storybook/pageStory";
import { RestockResolutionType } from "../../../gen/warehouse/inventory/v1/restock_resolution_pb";
import {
  DESKTOP,
  PHONE,
  SELLING_META,
  recordMenu,
  resolutionCalls,
  resolutionTypes,
  sellingAt,
  typeInto,
} from "../../../features/restockResolution/storyKit";

// RESTOCK SELLING DETAIL · RESOLUSI (backlog #101, live since the-restock-resolutions-prototype-is-accepted). A problem
// restock — Diterima with *Barang kurang* / *Barang rusak* — and a Hilang one carry a Resolusi section under the products:
// its rows (type, the refund's amount and account, the parcel a return or a reshipping rides and its step, the note, who
// and when), *Catat Resolusi* (Refund · Retur ke Supplier · Kirim Ulang — a Hilang restock has no Retur) and *Tandai
// Selesai*, which takes the problem tags off (a-restock-problem-is-settled-by-resolution-rows + every 🔄). A settled
// restock keeps *Catat Resolusi* and stays settled (🔄 A). The Riwayat carries REAL rows — one per resolution, per settle,
// per reopen (the owner's 🔄 A). The stub transport plays the server (.storybook/restockResolutionScenario.ts, seeded by
// the kit with the accepted prototype's rows).

const At503 = sellingAt("/inventories/restock/503");
const At504 = sellingAt("/inventories/restock/504");
const At501 = sellingAt("/inventories/restock/501");

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Resolutions",
  component: At503,
  ...SELLING_META,
  globals: DESKTOP,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function section(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-detail-page", {}, { timeout: 4000 });
  const box = await canvas.findByTestId("restock-detail-resolutions-section", {}, { timeout: 4000 });
  return { canvas, box: within(box) };
}

const chips = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll("[data-testid='restock-tags'] [data-tag-type]")].map((el) => el.getAttribute("data-testid"));

/** The Riwayat's rows of one kind, in the trail's order. */
const trailOf = (canvasElement: HTMLElement, kind: string) =>
  [...canvasElement.querySelectorAll(`[data-testid^='restock-timeline-'][data-kind='${kind}']`)] as HTMLElement[];

/**
 * A PROBLEM RESTOCK'S RESOLUSI — under the products, its own nav item: 503's refund (Rp 65.000 into BCA Operasional, the
 * note, who and when) and its reshipping (the inbound parcel #901, Dalam Perjalanan, 2 pcs by JNE); *Catat Resolusi* and
 * *Tandai Selesai*; the problem tags still on; each row also a row of the Riwayat.
 */
export const AProblemRestocksResolutions: Story = {
  name: "Problem restock — its resolutions",
  play: async ({ canvasElement }) => {
    const { canvas, box } = await section(canvasElement);
    await expect(canvas.getByTestId("section-nav-resolutions")).toHaveTextContent("Resolutions");
    const order = [...canvasElement.querySelectorAll("[id^='restock-section-']")].map((el) => el.id);
    await expect(order.indexOf("restock-section-resolutions")).toBe(order.indexOf("restock-section-products") + 1);

    await expect(resolutionTypes(canvasElement)).toEqual(["REFUND", "RESHIPPING"]);
    await waitFor(() => expect(box.getByTestId("resolution-row-1-refund")).toHaveTextContent("Rp 65.000 into BCA Operasional"));
    await expect(box.getByTestId("resolution-row-1-note")).toHaveTextContent("Supplier transfer untuk 1 karung yang kurang");
    await waitFor(() => expect(box.getByTestId("resolution-row-2-parcel")).toHaveTextContent("Reshipping #901"));
    await expect(within(box.getByTestId("resolution-row-2-parcel")).getByTestId("inbound-status-on_the_way")).toBeVisible();
    await expect(box.getByTestId("resolution-row-2-parcel")).toHaveTextContent("2 pcs");
    await expect(box.getByTestId("resolution-record")).toHaveTextContent("Record Resolution");
    await expect(box.getByTestId("resolution-settle")).toHaveTextContent("Mark Settled");

    await expect(chips(canvasElement)).toEqual(expect.arrayContaining([`restock-tag-${TAG.missing}`, `restock-tag-${TAG.broken}`]));
    // The Riwayat — the server's rows, one per resolution, each naming its row.
    const refundRow = canvas.getByTestId(`restock-timeline-${SEED_LOG.resolution(1n)}`);
    await expect(refundRow).toHaveAttribute("data-kind", "resolution");
    await expect(refundRow).toHaveTextContent("Resolution recorded");
    await waitFor(() => expect(refundRow).toHaveTextContent("Rp 65.000 into BCA Operasional"));
    await expect(canvas.getByTestId(`restock-timeline-${SEED_LOG.resolution(2n)}`)).toHaveTextContent("Reshipping #901");
  },
};

/**
 * CATAT RESOLUSI → REFUND — the menu offers all three on a received restock; the refund asks its amount and the account,
 * opening on the restock's own paying account (BCA Operasional); recorded, it is a row and a Riwayat row.
 */
export const RecordARefund: Story = {
  name: "Record — a refund (amount + account)",
  parameters: { resolutionSeed: "empty" },
  play: async ({ canvasElement }) => {
    const { canvas, box } = await section(canvasElement);
    await expect(box.getByTestId("resolution-empty")).toHaveTextContent("No resolution yet");
    await expect(await recordMenu(canvas)).toEqual(["resolution-record-refund", "resolution-record-return", "resolution-record-reshipping"]);
    await userEvent.click(screen.getByTestId("resolution-record-refund"));

    const dialog = within(await screen.findByTestId("resolution-refund-dialog", {}, { timeout: 3000 }));
    await waitFor(() => expect(dialog.getByTestId("resolution-refund-account")).toHaveTextContent("BCA Operasional"));
    const confirm = screen.getByTestId("confirm-action");
    await expect(confirm).toBeDisabled();
    await typeInto(dialog.getByTestId("resolution-refund-amount"), "65000");
    await typeInto(dialog.getByTestId("resolution-refund-note"), "Transfer dari supplier");
    await expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(box.getByTestId("resolution-row-101-refund")).toHaveTextContent("Rp 65.000 into BCA Operasional"));
    const calls = resolutionCalls();
    await expect(calls.map((c) => c.rpc)).toEqual(["RestockResolutionCreate"]);
    await expect(calls[0]!.req).toMatchObject({
      teamId: 12n,
      restockId: 503n,
      type: RestockResolutionType.REFUND,
      note: "Transfer dari supplier",
      refundAmount: 65000,
      financeAccountId: 1301n,
    });
    await waitFor(() => expect(trailOf(canvasElement, "resolution")).toHaveLength(1));
  },
};

/** RETUR — opens the live Paket Baru on *Kirim balik ke supplier*, restock 503 picked, saying it records the return. */
export const ReturnOpensPaketBaru: Story = {
  name: "Record — a return opens Paket Baru on the restock",
  parameters: { resolutionSeed: "empty" },
  play: async ({ canvasElement }) => {
    const { canvas } = await section(canvasElement);
    await recordMenu(canvas);
    await userEvent.click(screen.getByTestId("resolution-record-return"));

    const form = await canvas.findByTestId("custom-shipment-form", {}, { timeout: 4000 });
    await expect(within(form).getByTestId("custom-shipment-form-return")).toHaveTextContent("Return for restock #503");
    await waitFor(() => expect(within(form).getByTestId("custom-shipment-form-kind-reship")).toHaveAttribute("data-state", "checked"));
    await waitFor(() => expect(within(form).getByTestId("custom-shipment-form-name")).toHaveValue("PT Sumber Makmur"), { timeout: 4000 });
  },
};

/** KIRIM ULANG — opens its own form under the restock (the inbound parcel's lines, courier, resi, warehouse). */
export const ReshippingOpensItsForm: Story = {
  name: "Record — a reshipping opens its form",
  play: async ({ canvasElement }) => {
    const { canvas } = await section(canvasElement);
    await recordMenu(canvas);
    await userEvent.click(screen.getByTestId("resolution-record-reshipping"));
    const form = within(await canvas.findByTestId("reshipping-form", {}, { timeout: 4000 }));
    await expect(form.getByTestId("reshipping-back")).toHaveTextContent("Back to Restock #503");
  },
};

/**
 * TANDAI SELESAI — the confirm says the reshipping on its way is still counted in; confirmed, the restock reads *Selesai*
 * (title badge, the section's line), *Barang kurang* / *Barang rusak* are off the tag box, the Riwayat says it — and
 * *Catat Resolusi* STAYS (🔄 A: a late refund still lands; the restock stays settled); only *Tandai Selesai* goes.
 */
export const MarkSettled: Story = {
  name: "Mark settled — the problem tags come off, Catat Resolusi stays",
  play: async ({ canvasElement }) => {
    const { canvas, box } = await section(canvasElement);
    await waitFor(() => expect(chips(canvasElement)).toContain(`restock-tag-${TAG.missing}`));
    await userEvent.click(box.getByTestId("resolution-settle"));
    const dialog = await screen.findByRole("alertdialog", {}, { timeout: 3000 });
    await expect(dialog).toHaveTextContent("Mark Restock #503 Settled?");
    await expect(dialog).toHaveTextContent("a later one can still be recorded");
    await waitFor(() => expect(within(dialog).getByTestId("resolution-settle-open")).toHaveTextContent("1 reshipping is still on its way"));
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await expect(await box.findByTestId("resolution-settled", {}, { timeout: 3000 })).toHaveTextContent("Marked settled by Ani Rahayu");
    await expect(canvas.getByTestId("restock-detail-settled")).toHaveTextContent("Settled");
    await expect(box.getByTestId("resolution-record")).toBeVisible();
    await expect(box.queryByTestId("resolution-settle")).toBeNull();
    await waitFor(() => expect(chips(canvasElement)).toEqual([`restock-tag-${TAG.retur}`]));
    await waitFor(() => expect(trailOf(canvasElement, "settled")).toHaveLength(1));
    await expect(trailOf(canvasElement, "settled")[0]).toHaveTextContent("Marked settled");
    await expect(resolutionCalls().map((c) => c.rpc)).toEqual(["RestockRequestSettle"]);
    await expect(resolutionCalls()[0]!.req).toMatchObject({ teamId: 12n, requestId: 503n });
  },
};

/** SETTLED WITH NONE — allowed, the confirm says so (the supplier may refuse; the seller decides it is done). */
export const SettleWithNone: Story = {
  name: "Mark settled — with no resolution, said",
  parameters: { resolutionSeed: "empty" },
  play: async ({ canvasElement }) => {
    const { box } = await section(canvasElement);
    await userEvent.click(box.getByTestId("resolution-settle"));
    const dialog = await screen.findByRole("alertdialog", {}, { timeout: 3000 });
    await expect(within(dialog).getByTestId("resolution-settle-none")).toHaveTextContent("No resolution is recorded");
  },
};

/**
 * THE RIWAYAT — SETTLED, REOPENED (the owner's 🔄 A): 503 was marked settled, then its reshipping #901 was counted in 1
 * short — the server lifted the mark and wrote the REOPENED row (the counting warehouse member, the parcel, what was
 * short). Both rows stay; the restock reads open again (*Tandai Selesai* back).
 */
export const SettledThenReopened: Story = {
  name: "Riwayat — settled, then reopened by a short reshipping",
  beforeEach: () => {
    settledThenReopenedForStory();
  },
  play: async ({ canvasElement }) => {
    const { box } = await section(canvasElement);
    await expect(trailOf(canvasElement, "settled")).toHaveLength(1);
    const reopened = trailOf(canvasElement, "reopened");
    await expect(reopened).toHaveLength(1);
    await expect(reopened[0]).toHaveTextContent("Reopened");
    await expect(reopened[0]).toHaveTextContent("Reshipping #901 was counted in short or broken");
    await expect(reopened[0]).toHaveTextContent("Beras Pandan Wangi 5kg: 1 short");
    await waitFor(() => expect(reopened[0]).toHaveTextContent("Budi Santoso"));
    await expect(box.getByTestId("resolution-settle")).toBeVisible();
    await expect(box.queryByTestId("resolution-settled")).toBeNull();
  },
};

/** A HILANG RESTOCK — the same section; Catat Resolusi offers Refund and Kirim Ulang, never Retur (nothing came). */
export const ALostRestock: Story = {
  name: "Lost restock — refund and reshipping, no return",
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    const { canvas, box } = await section(canvasElement);
    await expect(resolutionTypes(canvasElement)).toEqual(["REFUND", "RESHIPPING"]);
    await waitFor(() => expect(box.getByTestId("resolution-row-3-refund")).toHaveTextContent("Rp 400.000 into BCA Operasional"));
    await waitFor(() => expect(within(box.getByTestId("resolution-row-4-parcel")).getByTestId("inbound-status-arrived")).toBeVisible());
    await expect(await recordMenu(canvas)).toEqual(["resolution-record-refund", "resolution-record-reshipping"]);
  },
};

/** NOT A PROBLEM — an ongoing restock has no Resolusi section. */
export const NotAProblem: Story = {
  name: "Ongoing restock — no section",
  render: () => <At501 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-detail-page", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("restock-detail-resolutions-section")).toBeNull();
    await expect(canvas.queryByTestId("section-nav-resolutions")).toBeNull();
  },
};

/** THE ADMIN TEAM MONITORING — reads the rows, records and settles nothing. */
export const AMonitorReads: Story = {
  name: "Monitor — reads, changes nothing",
  beforeEach: () => {
    asAdminTeam()();
    asTeam(12n)();
  },
  play: async ({ canvasElement }) => {
    const { box } = await section(canvasElement);
    await expect(box.getByTestId("resolution-row-1")).toBeVisible();
    await expect(box.queryByTestId("resolution-actions")).toBeNull();
  },
};

/** ON A PHONE — the section in the page's one column after the products, its two acts full width; nothing runs off. */
export const OnAPhone: Story = {
  name: "Phone — the section after the products",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const { box } = await section(canvasElement);
    await expect(window.innerWidth).toBe(390);
    await expect(box.getByTestId("resolution-row-2")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
