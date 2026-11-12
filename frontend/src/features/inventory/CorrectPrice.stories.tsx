import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam, asPlatformOnly, asRole } from "../../../.storybook/sessionScenario";
import { addBatchForStory } from "../../../.storybook/batchStub";
import { emptyBatchForStory, seedCorrectionForStory } from "../../../.storybook/batchPriceStub";
import { batchPriceScenario } from "../../../.storybook/batchPriceScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { BatchDetailPage } from "../../pages/batch-detail";
import { AtMinyak, loaded as productLoaded, openTab, sectionOf } from "../../pages/product-detail/stories/kit";

// KOREKSI HARGA — a batch's price correction (the-owning-team-revalues-with-a-reason, the-correct-price-prototype-is-accepted,
// a-corrected-price-is-above-zero, batch.md §Change Price Flow Example), on the live screens. InventoryService.BatchRevalue
// is answered by .storybook/batchPriceStub.ts with the server's rules, over the batch stubs' own rows — so the live reads
// show the new price and the history row.
//
//   Toko Anggrek (15) owns Minyak Goreng Sawit 2L (700). Its batch 7001 sits in Gudang Pusat (11): 60 arrived at
//   Rp 45.700, 30 used, 30 left — Rp 1.371.000. Corrected to Rp 44.500: the 30 left are worth Rp 1.335.000 (−Rp 36.000),
//   the 30 used keep Rp 45.700.
//
//   where                         who sees Correct Price                  who sees the correction
//   the product's Batch section   the owning team's Owner and Admin,      the owning team — its Stock history
//   (the owner's batches)         Root and the Administrator
//   a batch's page (the           Root and the Administrator only         the warehouse holding it — Riwayat
//   warehouse's)
//

// Batch 7001 as Gudang Pusat holds it — the same batch the owner's page lists (productStub: 60 at Rp 45.700, 30 left).
function holdMinyakAtPusat() {
  addBatchForStory({
    id: 7001n,
    deliveryId: 7001n,
    receiptNo: "RST-7001",
    productId: 700n,
    productCode: "SL-03-ANG-001",
    name: "Minyak Goreng Sawit 2L",
    unitCost: 45_700,
    arrived: 60n,
    used: 30n,
    ready: 30n,
    expiresIn: 0,
    age: 34,
    acceptedBy: 62n,
    shelves: [
      [41n, 40n],
      [43n, 20n],
    ],
  });
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const AtBatch7001 = routedPage(
  [
    { path: "/inventories/batches/:batchId", element: <BatchDetailPage /> },
    marker("/inventories/batches", "at-batch-list"),
    marker("/inventories/restock/:requestId", "at-restock-detail"),
  ],
  "/inventories/batches/7001",
);

const meta = {
  title: "Features/Inventory/CorrectPrice",
  component: AtMinyak,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(15n)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The owner's Batch section, loaded with its rows. */
async function batchSection(canvasElement: HTMLElement) {
  const canvas = await productLoaded(canvasElement);
  const section = await sectionOf(canvas, "batch");
  await section.findByTestId("pd-batch-row-7001", {}, { timeout: 5000 });
  return { canvas, section };
}

/** Opens Correct Price on one batch's row; the form, wherever it is portalled. */
async function openForm(section: ReturnType<typeof within>, batchId: bigint) {
  await userEvent.click(section.getByTestId(`pd-batch-correct-${batchId}`));
  return within(await screen.findByTestId("correct-price-dialog"));
}

async function typePrice(form: ReturnType<typeof within>, digits: string) {
  const input = form.getByTestId("correct-price-new");
  await userEvent.clear(input);
  await userEvent.type(input, digits);
}

/** The history row that is a price correction, by its from → to line. */
async function correctionRow(panel: HTMLElement, base: string) {
  return waitFor(() => {
    const price = panel.querySelector<HTMLElement>(`[data-testid^="${base}-row-"][data-testid$="-price"]`);
    expect(price).not.toBeNull();
    const id = price!.dataset.testid!.replace(`${base}-row-`, "").replace("-price", "");
    return within(panel.querySelector<HTMLElement>(`[data-testid="${base}-row-${id}"]`)!);
  });
}

// ── WHERE IT LIVES ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * THE OWNING TEAM CORRECTS FROM ITS BATCH SECTION — the owner's batches are on the product's page (a batch's own page is
 * the warehouse's), so each row ends with *Correct Price*, its icon first (an-action-button-carries-its-icon). Every row,
 * in whichever warehouse it sits.
 */
export const OnEveryBatchOfTheOwner: Story = {
  name: "Where — every batch row of the owner",
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);

    for (const id of [7001n, 7002n, 7003n]) {
      const button = section.getByTestId(`pd-batch-correct-${id}`);
      await expect(button).toHaveTextContent("Correct Price");
      await expect(button.querySelector("svg")).not.toBeNull();
    }
  },
};

/** THE OWNING TEAM'S ADMIN TOO (the-owning-team-revalues-with-a-reason: *"the Owner or Admin of the team that owns the batch"*). */
export const AnAdminMayToo: Story = {
  name: "Who — the Admin too",
  beforeEach: asRole(Role.SELLING_ADMIN),
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    await expect(section.getByTestId("pd-batch-correct-7001")).toBeVisible();
  },
};

/** CUSTOMER SERVICE READS THE CORRECTION, AND HAS NO BUTTON — the new price on the row, the row in Stock history. */
export const CustomerServiceReadsItOnly: Story = {
  name: "Who — CS reads it, no button",
  beforeEach: () => {
    asRole(Role.SELLING_CS)();
    seedCorrectionForStory({ batchId: 7001n, to: 44_500, reason: "Di nota Rp 44.500 — salah ketik saat diterima", actorUserId: 64n });
  },
  play: async ({ canvasElement }) => {
    const { canvas, section } = await batchSection(canvasElement);

    await expect(section.queryByTestId("pd-batch-correct-7001")).toBeNull();
    await expect(section.getByTestId("pd-batch-row-7001")).toHaveTextContent("Rp 44.500");

    const panel = await openTab(canvas, "history");
    const row = await correctionRow(canvas.getByTestId("pd-panel-history"), "pd-history");
    await expect(row.getByText(/Price corrected/)).toBeVisible();
    await expect(row.getByTestId(/-price$/)).toHaveTextContent("Rp 45.700 → Rp 44.500");
    await expect(row.getByTestId(/-actor$/)).toHaveTextContent("Dewi Lestari");
    await expect(panel.queryByTestId("pd-batch-correct-7001")).toBeNull();
  },
};

/** A MONITOR READS, NEVER WRITES (the-admin-team-monitors-read-only) — no button on any row. */
export const AMonitorHasNoButton: Story = {
  name: "Who — a monitor, no button",
  beforeEach: () => {
    asAdminTeam()();
    asTeam(15n)();
  },
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    await expect(section.queryByTestId("pd-batch-correct-7001")).toBeNull();
  },
};

// ── THE FORM ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * WHAT CHANGES, BEFORE ANYTHING POSTS — the current price, the new one, the reason; then the units left (unchanged) and
 * their value, by units × the difference (batch.md: change_valuation = delta_price_unit × stock_count). Save waits for
 * the reason.
 */
export const TheFormSaysWhatChanges: Story = {
  name: "Form — what changes",
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    const form = await openForm(section, 7001n);

    await expect(form.getByTestId("correct-price-batch")).toHaveTextContent("Batch #7001 · Gudang Pusat");
    await expect(form.getByTestId("correct-price-current")).toHaveTextContent("Rp 45.700");
    await expect(form.getByTestId("correct-price-effect-units")).toHaveTextContent("30 pcs · unchanged");
    await expect(form.getByTestId("correct-price-effect-value")).toHaveTextContent("Rp 1.371.000");
    await expect(form.getByTestId("correct-price-effect-delta")).toHaveTextContent("—");

    await typePrice(form, "44500");
    await expect(form.getByTestId("correct-price-effect-value")).toHaveTextContent("Rp 1.371.000 → Rp 1.335.000");
    await expect(form.getByTestId("correct-price-effect-delta")).toHaveTextContent("−Rp 36.000");
    // The reason is required — Save waits for it.
    await expect(form.getByTestId("correct-price-save")).toBeDisabled();

    await userEvent.type(form.getByTestId("correct-price-reason"), "Di nota Rp 44.500 — salah ketik Rp 45.700 saat diterima");
    await expect(form.getByTestId("correct-price-save")).toBeEnabled();
    await expect(form.getByTestId("correct-price-reason-count")).toHaveTextContent(/\/200$/);
  },
};

/** THE SAME PRICE CORRECTS NOTHING — said under the field; Save stays off. */
export const TheSamePriceIsRefused: Story = {
  name: "Rule — the same price",
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    const form = await openForm(section, 7001n);

    await typePrice(form, "45700");
    await userEvent.type(form.getByTestId("correct-price-reason"), "cek");
    await expect(form.getByTestId("correct-price-new-error")).toHaveTextContent("That is the current price — nothing to correct.");
    await expect(form.getByTestId("correct-price-effect-delta")).toHaveTextContent("—");
    await expect(form.getByTestId("correct-price-save")).toBeDisabled();
  },
};

/** ABOVE RP 0 (a-corrected-price-is-above-zero) — Rp 0 is refused in the form, as the server refuses it. */
export const ThePriceIsAboveZero: Story = {
  name: "Rule — above Rp 0",
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    const form = await openForm(section, 7001n);

    await typePrice(form, "0");
    await userEvent.type(form.getByTestId("correct-price-reason"), "barang rusak");
    await expect(form.getByTestId("correct-price-new-error")).toHaveTextContent("The price must be above Rp 0.");
    await expect(form.getByTestId("correct-price-save")).toBeDisabled();
  },
};

/** A REASON IS REQUIRED (the-owning-team-revalues-with-a-reason) — spaces are none; leaving it empty says why. */
export const AReasonIsRequired: Story = {
  name: "Rule — a reason is required",
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    const form = await openForm(section, 7001n);

    await typePrice(form, "44500");
    await userEvent.type(form.getByTestId("correct-price-reason"), "   ");
    await userEvent.tab();
    await expect(form.getByTestId("correct-price-reason-error")).toHaveTextContent("Say why — it is shown in the batch's history.");
    await expect(form.getByTestId("correct-price-save")).toBeDisabled();

    await userEvent.type(form.getByTestId("correct-price-reason"), "harga promo pemasok");
    await expect(form.queryByTestId("correct-price-reason-error")).toBeNull();
    await expect(form.getByTestId("correct-price-save")).toBeEnabled();
  },
};

/**
 * NO UNITS LEFT, NOTHING TO CORRECT — a correction reprices only the units left (the-correct-price-prototype-is-accepted:
 * *"refused — a batch with no units left"*); the units that left keep their price.
 */
export const NoUnitsLeftHasNothingToCorrect: Story = {
  name: "Rule — no units left",
  beforeEach: () => emptyBatchForStory(7003n),
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    const form = await openForm(section, 7003n);

    await expect(form.getByTestId("correct-price-no-units")).toHaveTextContent("This batch has no units left.");
    await expect(form.getByTestId("correct-price-new")).toBeDisabled();
    await expect(form.getByTestId("correct-price-reason")).toBeDisabled();
    await expect(form.getByTestId("correct-price-effect-units")).toHaveTextContent("0 pcs · unchanged");
    await expect(screen.getByTestId("correct-price-save")).toBeDisabled();
  },
};

// ── THE RESULT ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * SAVE ASKS FIRST, THEN CORRECTS — it is never rolled back (revaluation-and-opname-are-transaction-types), so the confirm
 * says it in figures. Then the row reads the new price and value, and Stock history a *Price corrected* row: no unit
 * moved, from → to, the value's change, why and who.
 */
export const SaveAsksFirstThenCorrects: Story = {
  name: "Result — confirm, then the price and the history row",
  play: async ({ canvasElement }) => {
    const { canvas, section } = await batchSection(canvasElement);
    const form = await openForm(section, 7001n);

    await typePrice(form, "44500");
    await userEvent.type(form.getByTestId("correct-price-reason"), "Di nota Rp 44.500 — salah ketik Rp 45.700 saat diterima");
    await userEvent.click(screen.getByTestId("correct-price-save"));

    const confirm = within(await screen.findByRole("alertdialog"));
    await expect(confirm.getByText("Correct the price of batch #7001?")).toBeVisible();
    await expect(
      confirm.getByText(/Rp 45\.700 → Rp 44\.500 for the 30 pcs left — their stock value changes by −Rp 36\.000\. It cannot be undone/),
    ).toBeVisible();
    await userEvent.click(confirm.getByTestId("confirm-action"));

    await waitFor(() => expect(screen.queryByTestId("correct-price-dialog")).toBeNull());
    const toasts = await screen.findAllByText("Batch #7001: Rp 45.700 → Rp 44.500");
    await expect(toasts.length).toBeGreaterThan(0);
    await expect(batchPriceScenario.calls).toEqual([
      {
        batchId: 7001n,
        teamId: 15n,
        expectedPrice: 45_700,
        newPrice: 44_500,
        reason: "Di nota Rp 44.500 — salah ketik Rp 45.700 saat diterima",
      },
    ]);

    // The batch's price and its units left's value — read again from the live read.
    await waitFor(() => expect(section.getByTestId("pd-batch-row-7001")).toHaveTextContent("Rp 44.500"));
    await expect(section.getByTestId("pd-batch-row-7001")).toHaveTextContent("Rp 1.335.000");

    // The history row — a correction, no unit moved, why and who; no Root badge (the owner, inside the team).
    await openTab(canvas, "history");
    const row = await correctionRow(canvas.getByTestId("pd-panel-history"), "pd-history");
    await expect(row.getByText(/Price corrected/)).toBeVisible();
    await expect(row.getByTestId(/-price$/)).toHaveTextContent("Rp 45.700 → Rp 44.500");
    await expect(row.getByTestId(/-value$/)).toHaveTextContent("−Rp 36.000");
    await expect(row.getByTestId(/-reason$/)).toHaveTextContent("Di nota Rp 44.500");
    await expect(row.getByTestId(/-actor$/)).toHaveTextContent("Ani Rahayu");
    await expect(row.queryByTestId("root-team-badge")).toBeNull();
  },
};

/** BACK FROM THE CONFIRM KEEPS THE FORM — as typed; nothing posts. */
export const BackKeepsTheForm: Story = {
  name: "Result — Back keeps the form",
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    const form = await openForm(section, 7001n);

    await typePrice(form, "44500");
    await userEvent.type(form.getByTestId("correct-price-reason"), "harga promo");
    await userEvent.click(screen.getByTestId("correct-price-save"));
    const confirm = within(await screen.findByRole("alertdialog"));
    await userEvent.click(confirm.getByRole("button", { name: "Back" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await expect(form.getByTestId("correct-price-new")).toHaveValue("44.500");
    await expect(form.getByTestId("correct-price-reason")).toHaveValue("harga promo");
    await expect(batchPriceScenario.calls).toEqual([]);
  },
};

/** THE SERVER'S REFUSAL STAYS IN THE FORM — the batch emptied while the form was open: nothing changes, the form says why. */
export const TheServerRefusalIsShown: Story = {
  name: "Result — the server refuses",
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    const form = await openForm(section, 7001n);

    await typePrice(form, "44500");
    await userEvent.type(form.getByTestId("correct-price-reason"), "harga promo");
    // An order takes the last 30 meanwhile.
    emptyBatchForStory(7001n);
    await userEvent.click(screen.getByTestId("correct-price-save"));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByTestId("confirm-action"));

    await expect(await form.findByTestId("correct-price-error")).toHaveTextContent("batch #7001 has no units left");
    await expect(batchPriceScenario.logs).toEqual([]);
  },
};

/**
 * A STALE FORM IS REFUSED — someone of the team corrected the batch while this form was open: the server judges the
 * price the form showed under the batch's lock, refuses, and says the price now; nothing is overwritten.
 */
export const AStaleFormIsRefused: Story = {
  name: "Result — a stale form is refused",
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    const form = await openForm(section, 7001n);

    await typePrice(form, "44500");
    await userEvent.type(form.getByTestId("correct-price-reason"), "harga promo");
    // A colleague corrects it to Rp 46.000 meanwhile.
    seedCorrectionForStory({ batchId: 7001n, to: 46_000, reason: "salah ketik", actorUserId: 64n, hoursAgo: 0 });
    await userEvent.click(screen.getByTestId("correct-price-save"));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByTestId("confirm-action"));

    await expect(await form.findByTestId("correct-price-error")).toHaveTextContent(
      "batch #7001's price changed to Rp 46.000 since the form opened",
    );
    await expect(batchPriceScenario.logs.map((l) => l.to)).toEqual([46_000]);
    await expect(form.getByTestId("correct-price-new")).toHaveValue("44.500");
  },
};

// ── THE WAREHOUSE'S BATCH PAGE ───────────────────────────────────────────────────────────────────────────────────────

/**
 * THE WAREHOUSE READS IT, NEVER MAKES IT (the-owning-team-revalues-with-a-reason: *"the warehouse | sees every revaluation
 * of a batch it holds, in that batch's history"*) — Koreksi as ever, no Correct Price; Info's price says what it was;
 * Siap is worth the new price, Tiba and Terpakai keep the old; Riwayat has the row, with no rack.
 */
export const TheWarehouseReadsIt: Story = {
  name: "Batch page — the warehouse reads it",
  render: () => <AtBatch7001 />,
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_OWNER)();
    holdMinyakAtPusat();
    seedCorrectionForStory({ batchId: 7001n, to: 44_500, reason: "Di nota Rp 44.500 — salah ketik saat diterima", actorUserId: 64n });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("batch-detail-page", {}, { timeout: 5000 });

    await expect(canvas.getByTestId("batch-detail-adjust")).toBeVisible();
    await expect(canvas.queryByTestId("batch-detail-correct-price")).toBeNull();

    await expect(canvas.getByTestId("batch-detail-unit-cost")).toHaveTextContent("Rp 44.500");
    await expect(canvas.getByTestId("batch-detail-unit-cost-corrected")).toHaveTextContent("corrected from Rp 45.700");
    await expect(canvas.getByTestId("batch-detail-ready-card")).toHaveTextContent("Rp 1.335.000");
    await expect(canvas.getByTestId("batch-detail-arrived-card")).toHaveTextContent("Rp 2.742.000");
    await expect(canvas.getByTestId("batch-detail-used-card")).toHaveTextContent("Rp 1.371.000");

    const row = await correctionRow(canvas.getByTestId("batch-history-panel"), "batch-detail-history");
    await expect(row.getByText(/Price corrected/)).toBeVisible();
    await expect(row.getByTestId(/-price$/)).toHaveTextContent("Rp 45.700 → Rp 44.500");
    await expect(row.getByTestId(/-value$/)).toHaveTextContent("−Rp 36.000");
    await expect(row.getByTestId(/-actor$/)).toHaveTextContent("Dewi Lestari");
    // No rack moved.
    await expect(row.getAllByRole("cell")[2]).toHaveTextContent("—");
  },
};

/**
 * ROOT, FROM OUTSIDE — Root and the Administrator may correct any batch, as everywhere; on the warehouse's page too
 * (Root's button there). The
 * correction is the OWNING team's, and Root is not one of them: the row carries *by Root team*
 * (an-override-shows-a-platform-badge).
 */
export const RootCorrectsFromOutside: Story = {
  name: "Batch page — Root corrects, by Root team",
  render: () => <AtBatch7001 />,
  beforeEach: () => {
    asTeam(11n)();
    asPlatformOnly(Role.ROOT, [])();
    holdMinyakAtPusat();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("batch-detail-page", {}, { timeout: 5000 });

    await userEvent.click(await canvas.findByTestId("batch-detail-correct-price"));
    const form = within(await screen.findByTestId("correct-price-dialog"));
    await expect(form.getByTestId("correct-price-current")).toHaveTextContent("Rp 45.700");
    await typePrice(form, "42000");
    await userEvent.type(form.getByTestId("correct-price-reason"), "Diminta pemilik — harga turun karena kemasan penyok");
    await userEvent.click(screen.getByTestId("correct-price-save"));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByTestId("confirm-action"));

    await expect(batchPriceScenario.calls[0]?.teamId).toBe(15n);
    const row = await correctionRow(canvas.getByTestId("batch-history-panel"), "batch-detail-history");
    await expect(row.getByTestId(/-price$/)).toHaveTextContent("Rp 45.700 → Rp 42.000");
    await expect(row.getByTestId(/-value$/)).toHaveTextContent("−Rp 111.000");
    await expect(row.getByTestId("root-team-badge")).toBeVisible();
    await expect(canvas.getByTestId("batch-detail-unit-cost")).toHaveTextContent("Rp 42.000");
  },
};

// ── A PHONE ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** ON A PHONE THE FORM IS A SHEET from the bottom, Cancel | Save Price as two halves (a-phone-edits-the-note-in-a-sheet). */
export const OnAPhoneTheFormIsASheet: Story = {
  name: "Phone — the form is a sheet",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const { section } = await batchSection(canvasElement);
    await expect(section.getByTestId("pd-batch-correct-7001")).toBeVisible();

    const form = await openForm(section, 7001n);
    await expect(screen.getByTestId("correct-price-sheet")).toBeVisible();
    await typePrice(form, "44500");
    await userEvent.type(form.getByTestId("correct-price-reason"), "Di nota Rp 44.500");
    await expect(form.getByTestId("correct-price-effect-delta")).toHaveTextContent("−Rp 36.000");

    const cancel = screen.getByTestId("correct-price-cancel").getBoundingClientRect();
    const save = screen.getByTestId("correct-price-save").getBoundingClientRect();
    await expect(Math.abs(cancel.width - save.width)).toBeLessThan(2);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/** ON A PHONE THE HISTORY ROW IS A BLOCK — the value's change where a unit change sits, from → to, then why and who. */
export const OnAPhoneTheRowIsABlock: Story = {
  name: "Phone — the warehouse's history row",
  globals: { viewport: { value: "mobile1" } },
  render: () => <AtBatch7001 />,
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
    holdMinyakAtPusat();
    seedCorrectionForStory({
      batchId: 7001n,
      to: 42_000,
      reason: "Diminta pemilik — harga turun karena kemasan penyok",
      actorUserId: 66n,
      isOverride: true,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("batch-detail-page", {}, { timeout: 5000 });
    // A phone's header action is an icon — Koreksi alone: the warehouse never corrects a price.
    await expect(canvas.queryByTestId("batch-detail-correct-price")).toBeNull();

    const row = await correctionRow(canvas.getByTestId("batch-history-panel"), "batch-detail-history");
    await expect(row.getByTestId(/-value$/)).toHaveTextContent("−Rp 111.000");
    await expect(row.getByTestId(/-price$/)).toHaveTextContent("Rp 45.700 → Rp 42.000");
    await expect(row.getByTestId(/-actor$/)).toHaveTextContent("Fajar Nugroho");
    await expect(row.getByTestId("root-team-badge")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
