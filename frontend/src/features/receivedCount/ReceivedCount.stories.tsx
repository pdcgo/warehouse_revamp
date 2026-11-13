import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam, asPlatformOnly, asRole } from "../../../.storybook/sessionScenario";
import { restockCorrectedForStory } from "../../../.storybook/restockStub";
import { transferCorrectedForStory } from "../../../.storybook/warehouseTransferStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockWarehouseDetailPage } from "../../pages/restock-warehouse-detail";
import { RestockSellingDetailPage } from "../../pages/restock-selling-detail";
import { WarehouseTransferWarehouseDetailPage } from "../../pages/warehouse-transfer-warehouse-detail";
import { WarehouseTransferSellingDetailPage } from "../../pages/warehouse-transfer-selling-detail";
import { BatchDetailPage } from "../../pages/batch-detail";

// KOREKSI JUMLAH TERIMA / CORRECT RECEIVED COUNT, LIVE (docs/business/inventory/adjustment_decision.md:
// the-warehouse-corrects-a-wrong-stock-in-alone, a-stock-in-correction-keeps-the-batch-price,
// a-wrong-stock-in-is-a-received-count-correction, the-received-count-prototype-is-accepted). The stubs play the server:
// restockStub.ts / warehouseTransferStub.ts answer RestockReceivedCountCorrect and WarehouseTransferReceivedCountCorrect
// with its rules (receivedCountScenario.ts), and the details, the batch page and its history read what they wrote.
//
//   where                                    who sees the action                          who reads the result
//   the receiving warehouse's restock page   its Owner and Admin, Root and the            the warehouse (units), the selling
//   and transfer page — accepted only        Administrator (stamped by Root team) —       team (units and the money it bears),
//                                            never Staff, the sender, the selling team,   the batch's history
//                                            a monitor
//
// The signed-in person is the stub's own (Ani Rahayu, SELF_ID); a correction a story SEEDS names who made it.

const WAREHOUSE_PAGE = (id: bigint) =>
  routedPage(
    [
      { path: "/inventories/restock/:requestId", element: <RestockWarehouseDetailPage /> },
      marker("/inventories/restock", "at-restock-list"),
    ],
    `/inventories/restock/${id}`,
  );
const SELLING_PAGE = (id: bigint) =>
  routedPage(
    [
      { path: "/inventories/restock/:requestId", element: <RestockSellingDetailPage /> },
      marker("/inventories/restock", "at-restock-list"),
    ],
    `/inventories/restock/${id}`,
  );
const TRANSFER_WAREHOUSE_PAGE = (id: bigint) =>
  routedPage(
    [
      { path: "/inventories/transfer/:transferId", element: <WarehouseTransferWarehouseDetailPage /> },
      marker("/inventories/transfer", "at-transfer-list"),
    ],
    `/inventories/transfer/${id}`,
  );
const TRANSFER_SELLING_PAGE = (id: bigint) =>
  routedPage(
    [
      { path: "/inventories/transfer/:transferId", element: <WarehouseTransferSellingDetailPage /> },
      marker("/inventories/transfer", "at-transfer-list"),
    ],
    `/inventories/transfer/${id}`,
  );

// Built ONCE, at module scope (pageStory.tsx).
const At503 = WAREHOUSE_PAGE(503n);
const At502 = WAREHOUSE_PAGE(502n);
const At507 = WAREHOUSE_PAGE(507n);
const Selling503 = SELLING_PAGE(503n);
const Transfer605 = TRANSFER_WAREHOUSE_PAGE(605n);
const TransferSelling605 = TRANSFER_SELLING_PAGE(605n);
const Batch5032 = routedPage(
  [{ path: "/inventories/batches/:batchId", element: <BatchDetailPage /> }, marker("/inventories/batches", "at-batch-list")],
  "/inventories/batches/5032",
);

/** Dewi (Gudang Pusat's Owner) found 18 tea where 20 were typed — made before the story opens. */
const TEA_REASON = "Dihitung ulang di rak A-01-2 — isi kotak 18, terketik 20";
const teaCorrected = (userId = 64n, isOverride = false) => () =>
  restockCorrectedForStory(503n, [{ itemId: 5032n, to: 18n, rackId: 42n }], TEA_REASON, userId, isOverride);

const meta = {
  title: "Features/ReceivedCount/CorrectReceivedCount",
  component: At503,
  parameters: { signedIn: true, dataRouter: true },
  // Gudang Pusat (11) receives restock 503 — as its Owner.
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

async function page(canvasElement: HTMLElement, testId: string): Promise<Canvas> {
  const canvas = within(canvasElement);
  await canvas.findByTestId(testId, {}, { timeout: 5000 });
  return canvas;
}

/** Opens the form from the page's header — a button, an icon, or (a transfer on a phone) inside ⋯. */
async function openForm(canvas: Canvas, prefix: "restock" | "transfer", id: string) {
  const testId = `${prefix}-action-correct-count-${id}`;
  const direct = await waitFor(() => {
    const el = canvas.queryByTestId(testId) ?? canvas.queryByTestId(`${prefix}-actions-${id}`);
    expect(el).not.toBeNull();
    return el!;
  });
  await userEvent.click(direct);
  if (direct.dataset.testid !== testId) await userEvent.click(await screen.findByTestId(testId));

  return within(await screen.findByTestId("rc-dialog"));
}

async function typeCount(form: Canvas, lineId: bigint, value: string) {
  const input = form.getByTestId(`rc-line-${lineId}-real`);
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

async function pickToRack(form: Canvas, lineId: bigint, rackId: bigint) {
  const field = within(form.getByTestId(`rc-line-${lineId}`));
  await userEvent.click(field.getByTestId(`rc-line-${lineId}-to`));
  const option = await field.findByTestId(`rack-select-option-${rackId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

/** Save, then the ConfirmDialog's confirm (it is never rolled back, so it asks). */
async function saveAndConfirm(message?: RegExp) {
  await userEvent.click(screen.getByTestId("rc-save"));
  const confirm = within(await screen.findByRole("alertdialog"));
  if (message) await expect(confirm.getByText(message)).toBeVisible();
  await userEvent.click(confirm.getByTestId("confirm-action"));
}

async function saved() {
  await waitFor(() => expect(screen.queryByTestId("rc-dialog")).toBeNull());
}

/** The trail's correction row — its own kind, never a status row. */
function correctionRow(canvasElement: HTMLElement, prefix: "restock" | "transfer"): Promise<HTMLElement> {
  return waitFor(() => {
    const el = canvasElement.querySelector<HTMLElement>(`[data-testid^="${prefix}-timeline-c"][data-kind="correction"]`);
    expect(el).not.toBeNull();
    return el!;
  });
}

// ── WHERE IT SITS, AND WHO ────────────────────────────────────────────────────────────────────────────────────────────

/** THE RECEIVING WAREHOUSE'S OWNER, ON AN ACCEPTED RESTOCK — *Correct Received Count* beside Print, its icon first. */
export const WhereTheOwnerFindsIt: Story = {
  name: "Where — the restock page, the warehouse's Owner",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const button = await canvas.findByTestId("restock-action-correct-count-503");
    await expect(button).toHaveTextContent("Correct Received Count");
    await expect(button.querySelector("svg")).not.toBeNull();
    await expect(canvas.getByTestId("restock-action-labels-503")).toBeVisible();
  },
};

/** THE WAREHOUSE'S ADMIN TOO. */
export const TheAdminToo: Story = {
  name: "Who — the warehouse's Admin too",
  beforeEach: asRole(Role.WAREHOUSE_ADMIN),
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    await expect(await canvas.findByTestId("restock-action-correct-count-503")).toBeVisible();
  },
};

/** STAFF COUNT THE BOX, BUT DO NOT CORRECT IT AFTER — no action; Print stays. */
export const NotForStaff: Story = {
  name: "Who — not the warehouse's Staff",
  beforeEach: asRole(Role.WAREHOUSE_STAFF),
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    await expect(await canvas.findByTestId("restock-action-labels-503")).toBeVisible();
    await expect(canvas.queryByTestId("restock-action-correct-count-503")).toBeNull();
  },
};

/** A MONITOR READS, NEVER CORRECTS (the-admin-team-monitors-read-only). */
export const NotForAMonitor: Story = {
  name: "Who — not a monitor",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    await expect(await canvas.findByTestId("restock-action-labels-503")).toBeVisible();
    await expect(canvas.queryByTestId("restock-action-correct-count-503")).toBeNull();
  },
};

/** NOTHING TO CORRECT BEFORE THE ACCEPT — an arrived box is counted by Terima, not corrected. */
export const NotBeforeTheAccept: Story = {
  name: "Where — not before the accept",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    await expect(await canvas.findByTestId("restock-action-accept-502")).toBeVisible();
    await expect(canvas.queryByTestId("restock-action-correct-count-502")).toBeNull();
  },
};

/** THE SELLING TEAM DOES NOT CORRECT — it reads (the-warehouse-corrects-a-wrong-stock-in-alone: *"does not approve it"*). */
export const NotForTheSellingTeam: Story = {
  name: "Who — not the selling team",
  render: () => <Selling503 />,
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    await canvas.findByTestId("restock-detail-items");
    await expect(canvasElement.querySelector("[data-testid^='restock-action-correct-count']")).toBeNull();
  },
};

// ── THE FORM'S RULES ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * EVERY LINE, ITS COUNT AS ACCEPTED, THE REAL COUNT, AND WHAT THE BATCH STILL HOLDS — the detail's `correction_facts`,
 * units only (a-warehouse-sees-no-seller-money). Nothing changed yet: Save waits, and says why.
 */
export const TheFormIsUnitsOnly: Story = {
  name: "Form — every line, units only",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const form = await openForm(canvas, "restock", "503");

    await expect(form.getByTestId("rc-line-5031-facts")).toHaveTextContent("Ordered 10 · Received 9 · broken 2");
    await expect(form.getByTestId("rc-line-5032-facts")).toHaveTextContent("Ordered 20 · Received 20");
    await expect(form.getByTestId("rc-line-5032-real")).toHaveValue("20");
    await expect(form.getByTestId("rc-line-5032-batch")).toHaveTextContent("Batch #5032 · 17 still in this warehouse");
    await expect(form.getByTestId("rc-unchanged")).toBeVisible();
    await expect(screen.getByTestId("rc-save")).toBeDisabled();
    await expect(screen.getByTestId("rc-dialog")).not.toHaveTextContent(/Rp\s/);
  },
};

/**
 * THE REFUSALS, EACH UNDER ITS LINE — not below the broken units (any-warehouse-member-counts-what-arrived), not above
 * the line (accept-refuses-more-than-the-line-says), a reason required (the-warehouse-corrects-a-wrong-stock-in-alone).
 */
export const TheFormRefuses: Story = {
  name: "Form — refusals: broken, over the line, no reason",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const form = await openForm(canvas, "restock", "503");

    await typeCount(form, 5031n, "1");
    await expect(form.getByTestId("rc-line-5031-error")).toHaveTextContent("Not below the broken units (2)");
    await expect(screen.getByTestId("rc-save")).toBeDisabled();

    await typeCount(form, 5031n, "11");
    await expect(form.getByTestId("rc-line-5031-error")).toHaveTextContent("More than ordered (10)");
    await expect(screen.getByTestId("rc-save")).toBeDisabled();

    await typeCount(form, 5031n, "9");
    await expect(form.queryByTestId("rc-line-5031-error")).toBeNull();
    await typeCount(form, 5032n, "18");
    await expect(form.getByTestId("rc-line-5032-effect")).toHaveTextContent("2 Missing (correction) — out of batch #5032");
    await userEvent.click(form.getByTestId("rc-reason"));
    await userEvent.tab();
    await expect(form.getByTestId("rc-reason-error")).toHaveTextContent("A reason is required");
    await expect(screen.getByTestId("rc-save")).toBeDisabled();

    await userEvent.type(form.getByTestId("rc-reason"), "Dihitung ulang");
    await expect(screen.getByTestId("rc-save")).toBeEnabled();
  },
};

/**
 * ONLY THE UNITS STILL THERE — restock 507's tea is all sold: taking 2 out is refused, saying what the batch holds
 * (a-stock-in-correction-keeps-the-batch-price: *"refused — taking out more units than the batch still holds"*).
 */
export const NotMoreThanTheBatchHolds: Story = {
  name: "Form — refused: more out than the batch holds",
  render: () => <At507 />,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const form = await openForm(canvas, "restock", "507");

    await expect(form.getByTestId("rc-line-5071-batch")).toHaveTextContent("Batch #5071 · 0 still in this warehouse");
    await typeCount(form, 5071n, "13");
    await expect(form.getByTestId("rc-line-5071-error")).toHaveTextContent("Batch #5071 still holds 0 here");
    await expect(form.queryByTestId("rc-line-5071-effect")).toBeNull();
    await expect(screen.getByTestId("rc-save")).toBeDisabled();
  },
};

/** UNITS OUT COME OFF A RACK HOLDING THE PRODUCT, NEVER BELOW IT (a-shelf-never-goes-below-zero). */
export const NotMoreThanTheRackHolds: Story = {
  name: "Form — refused: more off a rack than it holds",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const form = await openForm(canvas, "restock", "503");

    // Beras: 9 → 6 takes 3 off; A-01-1 holds 5 of it, B-02-1 2 — the fullest rack is offered first.
    await typeCount(form, 5031n, "6");
    await expect(form.getByTestId("rc-line-5031-effect")).toHaveTextContent("3 Missing (correction)");
    const line = within(form.getByTestId("rc-line-5031"));
    await waitFor(() => expect(line.getByTestId("rc-line-5031-from")).toHaveTextContent("A-01-1 · holds 5"));
    await userEvent.click(line.getByTestId("rc-line-5031-from"));
    await userEvent.click(await line.findByTestId("rc-line-5031-from-option-43"));
    await expect(form.getByTestId("rc-line-5031-error")).toHaveTextContent("B-02-1 holds only 2");
    await expect(screen.getByTestId("rc-save")).toBeDisabled();
  },
};

/**
 * A STALE FORM IS REFUSED BY THE SERVER, IN ITS OWN WORDS — the form opened on the tea at 20; meanwhile someone corrected
 * it to 19. Saving 18 is refused (the count the form showed is sent with each line): the form stays as typed, under the
 * server's message, and the page behind already reads 19.
 */
export const AStaleFormIsRefused: Story = {
  name: "Form — refused by the server: a stale form",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const form = await openForm(canvas, "restock", "503");
    await typeCount(form, 5032n, "18");
    await userEvent.type(form.getByTestId("rc-reason"), "Dihitung ulang");

    // Someone else, first.
    restockCorrectedForStory(503n, [{ itemId: 5032n, to: 19n, rackId: 42n }], "Rekan menghitung lebih dulu");

    await saveAndConfirm();
    await expect(await form.findByTestId("rc-error")).toHaveTextContent(/someone corrected it first/);
    await expect(screen.getByTestId("rc-dialog")).toBeVisible();
    await expect(form.getByTestId("rc-line-5032-real")).toHaveValue("18");

    await userEvent.click(screen.getByTestId("rc-cancel"));
    await saved();
    await waitFor(() => expect(canvas.getByTestId("restock-detail-received-72")).toHaveTextContent("19"));
    await expect(canvas.getByTestId("restock-detail-received-72-was")).toHaveTextContent("corrected from 20");
  },
};

// ── THE RESULT ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * TOO MANY TYPED — 20 tea typed, 18 in the box. The confirm says what it does; then the line reads 18 *corrected from
 * 20*, its Kurang *2 (correction)*, the title's missing count grows, and the history says *Received count corrected ·
 * 20 → 18* with the reason and who — no money on the warehouse's page (a-warehouse-sees-no-seller-money).
 */
export const TooManyTyped: Story = {
  name: "Result — too many typed (20 → 18)",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const form = await openForm(canvas, "restock", "503");
    await typeCount(form, 5032n, "18");
    await waitFor(() =>
      expect(within(form.getByTestId("rc-line-5032")).getByTestId("rc-line-5032-from")).toHaveTextContent("A-01-2 · holds 17"),
    );
    await userEvent.type(form.getByTestId("rc-reason"), TEA_REASON);
    await saveAndConfirm(/Teh Melati 100g 20 → 18/);
    await saved();

    await waitFor(() => expect(canvas.getByTestId("restock-detail-received-72")).toHaveTextContent("18"));
    await expect(canvas.getByTestId("restock-detail-received-72-was")).toHaveTextContent("corrected from 20");
    await expect(canvas.getByTestId("restock-detail-missing-72-count")).toHaveTextContent("2 (correction)");
    // Their worth is the selling team's — the warehouse's cell says no Rp, not "worth Rp 0".
    await expect(canvas.queryByTestId("restock-detail-missing-72-value")).toBeNull();
    await expect(canvas.getByTestId("restock-detail-missing")).toHaveTextContent("3");

    const row = within(await correctionRow(canvasElement, "restock"));
    await expect(row.getByText("Received count corrected · 20 → 18")).toBeVisible();
    await expect(row.getByText(/Teh Melati 100g · 2 Missing \(correction\)/)).toBeVisible();
    await expect(row.getByText(`“${TEA_REASON}”`)).toBeVisible();
    await expect(await row.findByText("Ani Rahayu")).toBeVisible();
    await expect(row.queryByText(/borne/)).toBeNull();
    await expect(row.queryByTestId("root-team-badge")).toBeNull();
    // Only the changed line was sent: one history row, the rice untouched.
    await expect(canvasElement.querySelectorAll("[data-kind='correction']")).toHaveLength(1);
    await expect(canvas.queryByTestId("restock-detail-received-74-was")).toBeNull();
  },
};

/**
 * TOO FEW TYPED — the rice typed missing was there: 9 → 10 puts 1 into batch 5031 at its price, onto a rack named here
 * (there-is-no-unplaced-pile); the door's Kurang nets to 0 — *1 − 1 (correction)*.
 */
export const TooFewTyped: Story = {
  name: "Result — too few typed (9 → 10)",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const form = await openForm(canvas, "restock", "503");
    await typeCount(form, 5031n, "10");
    await expect(form.getByTestId("rc-line-5031-effect")).toHaveTextContent("1 into batch #5031");
    await expect(form.getByTestId("rc-line-5031-error")).toHaveTextContent("Pick the rack");
    await pickToRack(form, 5031n, 43n);
    await expect(form.queryByTestId("rc-line-5031-error")).toBeNull();
    await userEvent.type(form.getByTestId("rc-reason"), "Satu karung terselip di bawah palet, ketemu saat bongkar");
    await saveAndConfirm(/Beras Pandan Wangi 5kg 9 → 10/);
    await saved();

    await waitFor(() => expect(canvas.getByTestId("restock-detail-received-74")).toHaveTextContent("10"));
    await expect(canvas.getByTestId("restock-detail-missing-74-count")).toHaveTextContent("1 − 1 (correction)");
    await expect(canvas.queryByTestId("restock-detail-missing")).toBeNull();
    const row = within(await correctionRow(canvasElement, "restock"));
    await expect(row.getByText("Received count corrected · 9 → 10")).toBeVisible();
    await expect(row.getByText(/1 into the batch/)).toBeVisible();
  },
};

/** ROOT, FROM OUTSIDE — may correct, as everywhere; the row is stamped *by Root team* (the-override-badge-is-accepted-as-by-root-team). */
export const RootIsStamped: Story = {
  name: "Who — Root corrects, by Root team",
  beforeEach: () => {
    asTeam(11n)();
    asPlatformOnly(Role.ROOT, [])();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const form = await openForm(canvas, "restock", "503");
    await typeCount(form, 5032n, "18");
    await userEvent.type(form.getByTestId("rc-reason"), "Diminta pemilik gudang lewat telepon");
    await saveAndConfirm();
    await saved();

    const row = within(await correctionRow(canvasElement, "restock"));
    await expect(await row.findByText("Ani Rahayu")).toBeVisible();
    await expect(row.getByTestId("root-team-badge")).toBeVisible();
  },
};

/**
 * THE SELLING TEAM'S VIEW — the same restock: the line's own *Missing (correction) +2* badge, and in its detail what
 * it is worth at the batch price, borne by the selling team (a-stock-in-correction-keeps-the-batch-price), why and who;
 * the history row with the money.
 */
export const TheSellingTeamSeesTheMoney: Story = {
  name: "Result — the selling team's view, with the money",
  render: () => <Selling503 />,
  beforeEach: () => {
    teaCorrected()();
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    await expect(await canvas.findByTestId("restock-detail-correction-badge-72")).toHaveTextContent("Missing (correction) +2");

    await userEvent.click(canvas.getByTestId("restock-detail-adjustment-72"));
    const detail = within(await screen.findByTestId("restock-detail-adjustment-72-dialog"));
    await expect(detail.getByTestId("restock-detail-received-72")).toHaveTextContent("18 (corrected from 20)");
    await expect(detail.getByTestId("restock-detail-correction-72-count")).toHaveTextContent("+2");
    await expect(detail.getByTestId("restock-detail-correction-72-value")).toHaveTextContent("worth Rp 32.333,333 · borne by the selling team");
    await waitFor(() => expect(detail.getByTestId("restock-detail-correction-72-why")).toHaveTextContent("Dewi Lestari"));
    await expect(detail.queryByTestId("root-team-badge")).toBeNull();
    await userEvent.keyboard("{Escape}");

    const row = within(await correctionRow(canvasElement, "restock"));
    await expect(row.getByText("Received count corrected · 20 → 18")).toBeVisible();
    await expect(row.getByText(/worth Rp 32\.333,333 · borne by the selling team/)).toBeVisible();
    await expect(await row.findByText("Dewi Lestari")).toBeVisible();
    // The selling team's note is still theirs — a correction is never read as the selling team's edit.
    await expect(canvas.getByTestId("restock-detail-note-selling-by")).toHaveTextContent("Ani Rahayu");
  },
};

/** ROOT'S CORRECTION, AS THE SELLING TEAM READS IT — who, with the *by Root team* badge, in the line's detail and the history. */
export const TheSellingTeamSeesTheRootStamp: Story = {
  name: "Result — the selling team's view, Root's correction",
  render: () => <Selling503 />,
  beforeEach: () => {
    teaCorrected(66n, true)();
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    await userEvent.click(await canvas.findByTestId("restock-detail-adjustment-72"));
    const detail = within(await screen.findByTestId("restock-detail-adjustment-72-dialog"));
    await waitFor(() => expect(detail.getByTestId("restock-detail-correction-72-why")).toHaveTextContent("Fajar Nugroho"));
    await expect(detail.getByTestId("root-team-badge")).toBeVisible();
    await userEvent.keyboard("{Escape}");

    const row = within(await correctionRow(canvasElement, "restock"));
    await expect(await row.findByText("Fajar Nugroho")).toBeVisible();
    await expect(row.getByTestId("root-team-badge")).toBeVisible();
  },
};

// ── A TRANSFER ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** B — GUDANG CABANG — CORRECTS WHAT IT ACCEPTED: 10 tea typed, 8 in the box. Never above what was sent. */
export const TheTransfersReceiverCorrects: Story = {
  name: "Transfer — the receiver corrects (10 → 8)",
  render: () => <Transfer605 />,
  beforeEach: () => {
    asTeam(14n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "transfer-detail-page");
    const form = await openForm(canvas, "transfer", "605");
    await expect(form.getByTestId("rc-subtitle")).toHaveTextContent("Transfer #605");
    await expect(form.getByTestId("rc-line-6052-facts")).toHaveTextContent("Sent 10 · Received 10");
    await expect(form.getByTestId("rc-line-6052-batch")).toHaveTextContent("Batch #6152 · 7 still in this warehouse");

    await typeCount(form, 6052n, "11");
    await expect(form.getByTestId("rc-line-6052-error")).toHaveTextContent("More than sent (10)");
    await typeCount(form, 6052n, "8");
    await expect(form.getByTestId("rc-line-6052-effect")).toHaveTextContent("2 Missing (correction) — out of batch #6152");
    await userEvent.type(form.getByTestId("rc-reason"), "Dihitung ulang di C-01-1 — isi kotak 8, terketik 10");
    await saveAndConfirm(/Teh Melati 100g 10 → 8/);
    await saved();

    await waitFor(() => expect(canvas.getByTestId("transfer-line-6052-arrived")).toHaveTextContent("8"));
    await expect(canvas.getByTestId("transfer-line-6052-arrived-was")).toHaveTextContent("corrected from 10");
    await expect(canvas.getByTestId("transfer-line-6052-missing")).toHaveTextContent("2 (correction)");
    const rowEl = await correctionRow(canvasElement, "transfer");
    await expect(within(rowEl).getByText("Received count corrected · 10 → 8")).toBeVisible();
    // Units only on the warehouse's side — no money in the row or the lines (a-warehouse-sees-no-seller-money).
    await expect(rowEl).not.toHaveTextContent(/Rp/);
    await expect(canvas.getByTestId("transfer-lines-card")).not.toHaveTextContent(/Rp/);
  },
};

/** TOO FEW ON A TRANSFER — the missing Beras was in the box: 5 → 6 puts 1 into B's batch, onto C-01-2. */
export const TheTransfersReceiverPutsOneBack: Story = {
  name: "Transfer — too few typed (5 → 6)",
  render: () => <Transfer605 />,
  beforeEach: () => {
    asTeam(14n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "transfer-detail-page");
    const form = await openForm(canvas, "transfer", "605");
    await typeCount(form, 6051n, "6");
    await expect(form.getByTestId("rc-line-6051-effect")).toHaveTextContent("1 into batch #6151");
    await pickToRack(form, 6051n, 45n);
    await userEvent.type(form.getByTestId("rc-reason"), "Karung terselip di truk");
    await saveAndConfirm(/Beras Pandan Wangi 5kg 5 → 6/);
    await saved();

    await waitFor(() => expect(canvas.getByTestId("transfer-line-6051-arrived")).toHaveTextContent("6"));
    await expect(canvas.getByTestId("transfer-line-6051-missing")).toHaveTextContent("1 − 1 (correction)");
    await expect(within(await correctionRow(canvasElement, "transfer")).getByText(/1 into the batch/)).toBeVisible();
  },
};

/** THE SENDER (A) HAS NO ACTION — it did not count the box. */
export const NotForTheSender: Story = {
  name: "Transfer — not the sending warehouse",
  render: () => <Transfer605 />,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "transfer-detail-page");
    await expect(await canvas.findByTestId("transfer-detail-side")).toHaveTextContent(/outgoing/i);
    await expect(canvasElement.querySelector("[data-testid^='transfer-action-correct-count']")).toBeNull();
  },
};

/** B'S STAFF HAVE NO ACTION EITHER. */
export const NotForTheReceiversStaff: Story = {
  name: "Transfer — not the receiver's Staff",
  render: () => <Transfer605 />,
  beforeEach: () => {
    asTeam(14n)();
    asRole(Role.WAREHOUSE_STAFF)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "transfer-detail-page");
    await canvas.findByTestId("transfer-line-6052-arrived");
    await expect(canvasElement.querySelector("[data-testid^='transfer-action']")).toBeNull();
  },
};

/** THE TRANSFER'S OWNER READS IT WITH THE MONEY — its loss grows by 2 × Rp 15.000; the history row says it. */
export const TheTransfersOwnerSeesTheMoney: Story = {
  name: "Transfer — the selling team's view, with the money",
  render: () => <TransferSelling605 />,
  beforeEach: () => {
    transferCorrectedForStory(605n, [{ itemId: 6052n, to: 8n, rackId: 44n }], "Dihitung ulang di C-01-1 — isi kotak 8, terketik 10");
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "transfer-detail-page");
    await expect(await canvas.findByTestId("transfer-line-6052-missing")).toHaveTextContent("2 (correction)");
    // 1 broken + 1 missing Beras (Rp 130.000) and the 2 tea (Rp 30.000).
    await expect(canvas.getByTestId("transfer-detail-loss")).toHaveTextContent("Rp 160.000");
    await expect(canvas.getByTestId("transfer-detail-problems")).toHaveTextContent("4");
    const row = within(await correctionRow(canvasElement, "transfer"));
    await expect(row.getByText(/worth Rp 30\.000 · borne by the selling team/)).toBeVisible();
    await expect(await row.findByText("Eko Prasetyo")).toBeVisible();
  },
};

// ── THE BATCH ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * THE BATCH'S HISTORY — the `adjustment` it posted, said as one: *Received count corrected · 20 → 18*, −2, why and who;
 * the 2 units are Hilang at the batch price, out of Siap (a-stock-in-correction-keeps-the-batch-price).
 */
export const TheBatchHistoryShowsIt: Story = {
  name: "Result — the batch's history",
  render: () => <Batch5032 />,
  beforeEach: teaCorrected(),
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "batch-detail-page");
    await expect(await canvas.findByTestId("batch-detail-lost")).toHaveTextContent("2");
    await expect(canvas.getByTestId("batch-detail-ready")).toHaveTextContent("15");
    const panel: HTMLElement = canvas.getByTestId("batch-history-panel");
    const row = await waitFor(() => {
      const count = panel.querySelector<HTMLElement>("[data-testid^='batch-detail-history-row-'][data-testid$='-count']");
      expect(count).not.toBeNull();
      const id = count!.dataset.testid!.replace("batch-detail-history-row-", "").replace("-count", "");
      return panel.querySelector<HTMLElement>(`[data-testid="batch-detail-history-row-${id}"]`)!;
    });
    await expect(row).toHaveTextContent("Received count corrected · 20 → 18");
    await expect(row).toHaveTextContent("-2");
    await expect(row).toHaveTextContent(TEA_REASON);
    await waitFor(() => expect(row).toHaveTextContent("Dewi Lestari"));
  },
};

// ── A PHONE ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** ON A PHONE — the action is its icon in the header; the form a bottom sheet, Cancel | Save Correction as halves. */
export const OnAPhone: Story = {
  name: "Phone — the icon, then a sheet",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "restock-detail-page");
    const form = await openForm(canvas, "restock", "503");
    await expect(screen.getByTestId("rc-sheet")).toBeVisible();
    await typeCount(form, 5032n, "18");
    await userEvent.type(form.getByTestId("rc-reason"), "Dihitung ulang");

    const cancel = screen.getByTestId("rc-cancel").getBoundingClientRect();
    const save = screen.getByTestId("rc-save").getBoundingClientRect();
    await expect(Math.abs(cancel.width - save.width)).toBeLessThan(2);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await saveAndConfirm();
    await saved();
    // The line's block says it, as the table does.
    await waitFor(() => expect(canvas.getByTestId("restock-detail-received-72")).toHaveTextContent("18"));
    await expect(canvas.getByTestId("restock-detail-received-72-was")).toHaveTextContent("corrected from 20");
    await expect(canvas.getByTestId("restock-detail-missing-72-count")).toHaveTextContent("2 (correction)");
  },
};

/** A TRANSFER ON A PHONE — the action sits in the header's ⋯; the same sheet. */
export const TransferOnAPhone: Story = {
  name: "Phone — a transfer: ⋯, then a sheet",
  globals: { viewport: { value: "mobile1" } },
  render: () => <Transfer605 />,
  beforeEach: () => {
    asTeam(14n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement, "transfer-detail-page");
    const form = await openForm(canvas, "transfer", "605");
    await expect(screen.getByTestId("rc-sheet")).toBeVisible();
    await expect(form.getByTestId("rc-line-6052-facts")).toHaveTextContent("Sent 10 · Received 10");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
