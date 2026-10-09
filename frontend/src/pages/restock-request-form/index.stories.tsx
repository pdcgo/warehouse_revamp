import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { restockFixture } from "../../../.storybook/restockFixtures";
import { resetRestockStub } from "../../../.storybook/restockStub";
import { supplierFixture } from "../../../.storybook/supplierFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestFormPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock form against the decided design
// (docs/business/inventory/restock_decision.md). The stub plays the restock rules (restockStub.ts) and supplier_service
// (supplierStub.ts).
//
// Toko Melati (12) raises restocks into Gudang Pusat (11). 501 is ongoing (every field), 502 arrived (the lines only),
// 503 accepted (not editable). Team 12's catalogue holds ONE product, Beras 74.

const ONGOING = restockFixture(501n);
const ARRIVED = restockFixture(502n);
const ACCEPTED = restockFixture(503n);

const BERAS = 74n; // team 12's own product
const KOPI = 71n;
const CAHAYA = supplierFixture("CV Cahaya Abadi");
const CAHAYA_STORE = 321n;
const BCA_OPS = 1301n;

const Create = routedPage(
  [
    { path: "/inventories/restock/new", element: <RestockRequestFormPage key="create" /> },
    marker("/inventories/restock", "at-restock-list"),
  ],
  "/inventories/restock/new",
);

function routedEdit(requestId: bigint) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId/edit", element: <RestockRequestFormPage key="edit" /> },
      marker("/inventories/restock/:requestId", "at-restock-detail"),
      marker("/inventories/restock", "at-restock-list"),
    ],
    `/inventories/restock/${requestId}/edit`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const EditOngoing = routedEdit(ONGOING.id);
const EditArrived = routedEdit(ARRIVED.id);
const EditAccepted = routedEdit(ACCEPTED.id);

/**
 * 502 holds BOTH of the products on team 12's restocks, so its picker has nothing new to add. For the add-a-line
 * rule, this beforeEach takes Beras off 502 for one story — so it can come back as a product found in the box — and
 * puts it back after.
 */
function arrivedWithoutBeras() {
  const saved = ARRIVED.items;
  ARRIVED.items = saved.filter((l) => l.productId !== BERAS);
  resetRestockStub();

  return () => {
    ARRIVED.items = saved;
    resetRestockStub();
  };
}

const meta = {
  title: "Pages/Restock/RestockRequestForm",
  component: Create,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

async function loaded(canvasElement: HTMLElement, testId: string) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(testId, {}, { timeout: 4000 });

  return canvas;
}

/** Tick products in the picker dialog and confirm. The dialog portals, so its rows are on `screen`. */
async function pickProducts(canvas: Canvas, productIds: bigint[]) {
  await userEvent.click(canvas.getByTestId("restock-pick-products"));

  for (const id of productIds) {
    const row = await screen.findByTestId(`product-picker-option-${id}`, {}, { timeout: 4000 });
    await waitFor(() => expect(row).toBeVisible());
    await userEvent.click(row);
  }

  await userEvent.click(await screen.findByTestId("product-picker-confirm"));
  await waitFor(() => expect(screen.queryByTestId("product-picker-dialog")).toBeNull());
}

/** FinancialAccountSelect does not portal — its listbox is inside the canvas. */
async function pickAccount(canvas: Canvas, accountId: bigint) {
  await userEvent.click(canvas.getByTestId("restock-finance-account"));
  const option = await canvas.findByTestId(`restock-finance-account-option-${accountId}`, {}, { timeout: 4000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const CreateAsOwner: Story = {};

export const CreateAsCustomerService: Story = {
  beforeEach: () => {
    asRole(Role.SELLING_CS)();
  },
};

export const EditWhileOngoing: Story = { render: () => <EditOngoing /> };

export const EditWhileArrived: Story = { render: () => <EditArrived /> };

export const NotEditableOnceAccepted: Story = { render: () => <EditAccepted /> };

// The warehouse can READ the restock, so its detail call succeeds — but only the raising team edits it.
export const NotTheRaisingTeam: Story = {
  render: () => <EditOngoing />,
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-not-editable");

    await expect(canvas.getByTestId("restock-not-editable-reason")).toHaveTextContent("Only the team that raised");
    await expect(canvas.queryByTestId("submit-restock")).toBeNull();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// a-restock-names-its-paying-account: the account is REQUIRED — Save waits for it, and says so.
export const PayingAccountIsRequiredBeforeSubmit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await pickTeam(canvas.getByTestId("restock-warehouse"), "WH-01");
    await pickProducts(canvas, [BERAS]);
    await canvas.findByTestId("restock-line-0");

    await expect(canvas.getByTestId("submit-restock")).toBeDisabled();
    await expect(canvas.getByTestId("restock-form-missing-account")).toBeInTheDocument();

    await pickAccount(canvas, BCA_OPS);

    await waitFor(() => expect(canvas.queryByTestId("restock-form-missing")).toBeNull());
    await expect(canvas.getByTestId("submit-restock")).toBeEnabled();

    await userEvent.click(canvas.getByTestId("submit-restock"));
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};

// a-product-appears-once-per-restock: a product is ticked, not added — picking it again cannot make a second line.
export const AProductIsListedOnce: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await pickProducts(canvas, [BERAS]);
    await canvas.findByTestId("restock-line-0");

    // Opened again, the product on the list is already ticked …
    await userEvent.click(canvas.getByTestId("restock-pick-products"));
    const row = await screen.findByTestId(`product-picker-option-${BERAS}`, {}, { timeout: 4000 });
    await waitFor(() => expect(within(row).getByRole("checkbox")).toBeChecked());
    await userEvent.click(await screen.findByTestId("product-picker-confirm"));
    await waitFor(() => expect(screen.queryByTestId("product-picker-dialog")).toBeNull());

    // … so confirming keeps ONE line.
    await expect(canvas.getByTestId("restock-line-0")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-line-1")).toBeNull();
    await expect(canvas.getByTestId("restock-summary-count")).toHaveTextContent("1");
  },
};

// a-line-connects-to-any-teams-supplier-from-a-popup: Connect Supplier Channel → a supplier and one of its stores →
// the line shows both. And a supplier can be cleared off a line again.
export const ConnectingASupplierShowsItOnTheLine: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    // Line 2 (Teh) is connected to nothing yet.
    await waitFor(() =>
      expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent("Not connected to a supplier"),
    );

    await userEvent.click(canvas.getByTestId("restock-line-2-picker-trigger"));
    const dialog = within(await screen.findByTestId("restock-line-2-picker-dialog"));
    await userEvent.type(dialog.getByTestId("restock-line-2-picker-search"), "Cahaya", { delay: 20 });
    await userEvent.click(await dialog.findByTestId(`restock-line-2-picker-supplier-${CAHAYA.id}`, {}, { timeout: 4000 }));
    await userEvent.click(await dialog.findByTestId(`restock-line-2-picker-store-${CAHAYA_STORE}`, {}, { timeout: 4000 }));
    await userEvent.click(dialog.getByTestId("restock-line-2-picker-confirm"));

    const shown = canvas.getByTestId("restock-line-2-supplier-shown");
    await waitFor(() => expect(shown).toHaveTextContent(CAHAYA.name), { timeout: 4000 });
    await waitFor(() => expect(shown).toHaveTextContent("cahayaabadi.co.id"), { timeout: 4000 });

    // a-line-may-name-a-supplier-without-a-channel — line 1 is a stall.
    await expect(canvas.getByTestId("restock-line-1-supplier-shown")).toHaveTextContent("No store — bought offline");

    // Cleared, line 0 is connected to nothing again.
    await userEvent.click(canvas.getByTestId("restock-line-0-supplier-clear"));
    await expect(canvas.getByTestId("restock-line-0-supplier-shown")).toHaveTextContent("Not connected to a supplier");
  },
};

// the-lines-stay-editable-until-accepted: while ARRIVED the payment and the parcel are closed — and say why — while
// each line's count, total and note stay open, and no stored line can be removed or re-connected.
export const ArrivedClosesTheHeaderAndKeepsTheLines: Story = {
  render: () => <EditArrived />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.getByTestId("restock-arrived-banner")).toBeVisible();
    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeInTheDocument();
    await expect(canvas.getByTestId("restock-header-locked")).toBeVisible();

    await expect(canvas.getByTestId("restock-finance-account")).toBeDisabled();
    await expect(canvas.getByTestId("restock-invoice-ref")).toBeDisabled();
    await expect(canvas.getByTestId("restock-receipt")).toBeDisabled();
    await expect(canvas.getByTestId("restock-shipping-cost")).toBeDisabled();
    await expect(canvas.getByTestId("restock-note")).toBeDisabled();
    await expect(within(canvas.getByTestId("restock-courier")).getByRole("combobox")).toBeDisabled();
    await expect(canvas.getByTestId("order-receipt-pick")).toBeDisabled();

    // The lines stay open …
    await expect(canvas.getByTestId("restock-qty-0")).toBeEnabled();
    await expect(canvas.getByTestId("restock-total-price-0")).toBeEnabled();
    await expect(canvas.getByTestId("restock-line-0-note")).toBeEnabled();
    await expect(canvas.getByTestId("restock-line-0-note")).toHaveValue("extra stock — 2 bonus dari supplier");

    // … but none can be removed, and none re-connected (lines-can-be-added-not-removed-while-arrived).
    await expect(canvas.queryByTestId("restock-remove-0")).toBeNull();
    await expect(canvas.queryByTestId("restock-remove-1")).toBeNull();
    await expect(canvas.queryByTestId("restock-line-0-picker-trigger")).toBeNull();
    await expect(canvas.queryByTestId("restock-line-0-supplier-clear")).toBeNull();
  },
};

// lines-can-be-added-not-removed-while-arrived: a product found in the box can be ADDED — with a note — and that new
// line, never saved, can still be dropped; the stored one cannot. a-line-added-after-arrival-names-its-supplier: the
// added line may connect where it was bought, while the stored line's supplier stays closed.
export const ArrivedAddsALineOnlyWithANote: Story = {
  render: () => <EditArrived />,
  beforeEach: arrivedWithoutBeras,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    await canvas.findByTestId("restock-line-0");

    await pickProducts(canvas, [BERAS]);

    const added = await canvas.findByTestId("restock-line-1");
    await expect(within(added).getByTestId("restock-line-1-added")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-remove-0")).toBeNull();
    await expect(canvas.getByTestId("restock-remove-1")).toBeInTheDocument();

    // The added line can say where it came from; the stored one cannot be re-connected.
    await expect(canvas.queryByTestId("restock-line-0-picker-trigger")).toBeNull();
    await userEvent.click(canvas.getByTestId("restock-line-1-picker-trigger"));
    const dialog = within(await screen.findByTestId("restock-line-1-picker-dialog"));
    await userEvent.type(dialog.getByTestId("restock-line-1-picker-search"), "Cahaya", { delay: 20 });
    await userEvent.click(await dialog.findByTestId(`restock-line-1-picker-supplier-${CAHAYA.id}`, {}, { timeout: 4000 }));
    await userEvent.click(await dialog.findByTestId(`restock-line-1-picker-store-${CAHAYA_STORE}`, {}, { timeout: 4000 }));
    await userEvent.click(dialog.getByTestId("restock-line-1-picker-confirm"));
    await waitFor(() => expect(canvas.getByTestId("restock-line-1-supplier-shown")).toHaveTextContent("Cahaya Abadi"));

    // No note, no save.
    await expect(canvas.getByTestId("submit-restock")).toBeDisabled();
    await expect(canvas.getByTestId("restock-form-missing-newLineNote")).toBeInTheDocument();

    await userEvent.type(canvas.getByTestId("restock-line-1-note"), "ada di dalam paket", { delay: 20 });

    await waitFor(() => expect(canvas.getByTestId("submit-restock")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("submit-restock"));
    await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 });
  },
};

// the-couriers-charge-stays-out-of-total: the total is goods + shipping, tracking what is typed — there is no courier's
// charge on this form, and the summary says where it goes instead.
export const TotalsAreGoodsPlusShippingOnly: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    // 650.000 + 960.000 + 450.000 of goods, 20.000 of shipping.
    await waitFor(() => expect(canvas.getByTestId("restock-summary-products")).toHaveTextContent("Rp 2.060.000"));
    await expect(canvas.getByTestId("restock-summary-shipping")).toHaveTextContent("Rp 20.000");
    await expect(canvas.getByTestId("restock-summary-total")).toHaveTextContent("Rp 2.080.000");

    const total = canvas.getByTestId("restock-total-price-2");
    await userEvent.clear(total);
    await userEvent.type(total, "500000", { delay: 20 });
    const shipping = canvas.getByTestId("restock-shipping-cost");
    await userEvent.clear(shipping);
    await userEvent.type(shipping, "25000", { delay: 20 });

    await waitFor(() => expect(canvas.getByTestId("restock-summary-total")).toHaveTextContent("Rp 2.135.000"));
    await expect(canvas.getByTestId("restock-summary-products")).toHaveTextContent("Rp 2.110.000");
    await expect(canvas.getByTestId("restock-summary-courier-note")).toBeVisible();
  },
};

// a-line-is-typed-as-its-total: the piece price is derived from the total, never typed.
export const ThePiecePriceIsDerived: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    // Kopi: 24 for Rp 960.000 → Rp 40.000 a piece.
    await waitFor(() => expect(canvas.getByTestId("restock-per-piece-1")).toHaveTextContent("Rp 40.000"));
  },
};

// a-restock-is-edited-only-while-ongoing: an accepted restock opens as "cannot be edited", not as a form the server
// would refuse.
export const AnAcceptedRestockIsNotEditable: Story = {
  render: () => <EditAccepted />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-not-editable");

    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ACCEPTED}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId("submit-restock")).toBeNull();

    await userEvent.click(canvas.getByTestId("restock-not-editable-back"));
    await canvas.findByTestId("at-restock-detail");
  },
};

// The fields the backend does not store yet carry their marks, and the strip at the top names them.
export const UnstoredFieldsAreMarked: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.getByTestId("not-implemented-summary")).toBeInTheDocument();
    await expect(canvas.getByTestId("not-implemented-financeAccount")).toBeInTheDocument();
    await expect(canvas.getByTestId("not-implemented-shipment")).toBeInTheDocument();
    await expect(canvas.getByTestId("not-implemented-receiptFile")).toBeInTheDocument();
    // One per line.
    await expect(canvas.getAllByTestId("not-implemented-lineSupplier")).toHaveLength(ONGOING.items.length);
    await expect(canvas.getAllByTestId("not-implemented-lineNote")).toHaveLength(ONGOING.items.length);
  },
};

// Kopi is not team 12's product — a stored line keeps it (the sku and name are a snapshot), shown as ordered.
export const AStoredLineKeepsItsSnapshot: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const kopi = ONGOING.items.find((l) => l.productId === KOPI)!;

    await expect(canvas.getByTestId("restock-line-1")).toHaveTextContent(kopi.name);
    await expect(canvas.getByTestId("restock-qty-1")).toHaveValue(String(kopi.count));
  },
};
