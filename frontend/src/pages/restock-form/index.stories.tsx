import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { restockFixture } from "../../../.storybook/restockFixtures";
import { resetRestockStub } from "../../../.storybook/restockStub";
import { supplierFixture } from "../../../.storybook/supplierFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockFormPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock form against the decided design
// (docs/business/inventory/restock_decision.md). The stub plays the restock rules (restockStub.ts) and supplier_service
// (supplierStub.ts).
//
// Toko Melati (12) raises restocks into Gudang Pusat (11). 501 is ongoing (every field), 502 arrived (the lines only),
// 503 accepted (not editable). Team 12's catalogue holds three products: Beras 74, Tepung 75, Kecap 76.

const ONGOING = restockFixture(501n);
const ARRIVED = restockFixture(502n);
const ACCEPTED = restockFixture(503n);

const BERAS = 74n; // team 12's own products
const TEPUNG = 75n;
const KECAP = 76n;
const KOPI = 71n;
const CAHAYA = supplierFixture("CV Cahaya Abadi");
const CAHAYA_STORE = 321n;
const SUMBER = supplierFixture("PT Sumber Makmur");
const SUMBER_SHOPEE = 311n;
const SINAR = supplierFixture("Toko Grosir Sinar"); // no store at all — a stall
const BCA_OPS = 1301n;

const Create = routedPage(
  [
    { path: "/inventories/restock/new", element: <RestockFormPage key="create" /> },
    marker("/inventories/restock", "at-restock-list"),
  ],
  "/inventories/restock/new",
);

function routedEdit(requestId: bigint) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId/edit", element: <RestockFormPage key="edit" /> },
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
  title: "Pages/Inventory/Restock/RestockForm",
  component: Create,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
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

/**
 * Connect a supplier in an open SupplierChannelPicker — `prefix` is its testId. Without a store the supplier is a stall,
 * whose "no store" is chosen for it.
 */
async function connectSupplier(prefix: string, search: string, supplierId: bigint, storeId?: bigint) {
  const dialog = within(await screen.findByTestId(`${prefix}-dialog`, {}, { timeout: 4000 }));

  await userEvent.type(dialog.getByTestId(`${prefix}-search`), search, { delay: 20 });
  await userEvent.click(await dialog.findByTestId(`${prefix}-supplier-${supplierId}`, {}, { timeout: 4000 }));
  if (storeId !== undefined) {
    await userEvent.click(await dialog.findByTestId(`${prefix}-store-${storeId}`, {}, { timeout: 4000 }));
  }
  await waitFor(() => expect(dialog.getByTestId(`${prefix}-confirm`)).toBeEnabled(), { timeout: 4000 });
  await userEvent.click(dialog.getByTestId(`${prefix}-confirm`));
  await waitFor(() => expect(screen.queryByTestId(`${prefix}-dialog`)).toBeNull());
}

/** FinancialAccountSelect does not portal — its listbox is inside the canvas. */
async function pickAccount(canvas: Canvas, accountId: bigint) {
  await userEvent.click(canvas.getByTestId("restock-finance-account"));
  const option = await canvas.findByTestId(`restock-finance-account-option-${accountId}`, {}, { timeout: 4000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/** A new restock, as the selling team's owner. */
export const Default: Story = {};

// A PHONE (every-page-has-a-mobile-story) — one column; nothing runs past the screen's edge
// (nothing-runs-past-a-phones-edge), the empty Produk card offers the picker.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await expect(within(canvas.getByTestId("restock-no-products")).getByTestId("restock-pick-products")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// …and an ongoing restock on a phone, its lines filled.
export const MobileEdit: Story = {
  globals: { viewport: { value: "mobile1" } },
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.getByTestId("restock-line-0")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

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

// THE CHECKS RUN IN THE FORM'S ORDER (owner: *"untuk urutan validasi restocknya mulai dari produk, gudang, rekening,
// resi"*, *"di produk perlu cek semuanya punya supplier dulu"*, the-checks-run-products-warehouse-account-resi) — the line
// by Buat Restok names one thing at a time: the products, a supplier and a total on every one, the warehouse, the paying account
// (a-restock-names-its-paying-account), the resi; then the ready mark, and Buat Restok saves.
export const TheChecksRunProductsWarehouseAccountResi: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const button = canvas.getByTestId("submit-restock");
    const first = (id: string) => waitFor(() => expect(canvas.getByTestId(`restock-form-missing-${id}`)).toBeVisible());

    await first("lines");
    await pickProducts(canvas, [BERAS]);
    await first("supplier");
    await expect(canvas.getByTestId("restock-line-0-supplier-required")).toBeVisible();

    await userEvent.click(canvas.getByTestId("restock-line-0-picker-trigger"));
    await connectSupplier("restock-line-0-picker", "Cahaya", CAHAYA.id, CAHAYA_STORE);
    // The count starts at 1; the TOTAL must be typed (the-count-and-total-are-required).
    await first("total");
    await expect(canvas.getByTestId("restock-total-required-0")).toBeVisible();
    await userEvent.type(canvas.getByTestId("restock-total-price-0"), "650000", { delay: 20 });
    await first("warehouse");

    await pickTeam(canvas.getByTestId("restock-warehouse"), "WH-01");
    await first("account");
    await expect(button).toBeDisabled();

    await pickAccount(canvas, BCA_OPS);
    await first("receipt");
    await expect(button).toBeDisabled();

    await userEvent.type(canvas.getByTestId("restock-receipt"), "JNE0123456789", { delay: 20 });

    await waitFor(() => expect(canvas.queryByTestId("restock-form-missing")).toBeNull());
    // Everything in: the ready mark (a-save-button-says-what-it-waits-for).
    await expect(canvas.getByTestId("restock-form-ready")).toHaveTextContent("Ready to create");
    await expect(canvas.getByTestId("submit-restock")).toBeEnabled();

    await userEvent.click(canvas.getByTestId("submit-restock"));
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};

// SEVERAL PRODUCTS IN ONE PICK (owner: *"di halaman ini aku tidak bisa multi produk … maksudku di storynya"*) — team 12's
// catalogue holds three now, and the picker takes them together: one line each, in the order ticked.
export const SeveralProductsInOnePick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await pickProducts(canvas, [BERAS, TEPUNG, KECAP]);

    await waitFor(() => expect(canvas.getByTestId("restock-summary-count")).toHaveTextContent("3"));
    await expect(canvas.getByTestId("restock-line-0")).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(canvas.getByTestId("restock-line-1")).toHaveTextContent("Tepung Terigu 1kg");
    await expect(canvas.getByTestId("restock-line-2")).toHaveTextContent("Kecap Manis 600ml");
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
      expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent("Not chosen yet"),
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
    await expect(canvas.getByTestId("restock-line-0-supplier-shown")).toHaveTextContent("Not chosen yet");
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

    // No supplier for all while the box is at the door — the stored lines' suppliers are closed
    // (the-supplier-leads-the-produk-card).
    await expect(canvas.queryByTestId("restock-all-supplier")).toBeNull();
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

    // Its total, which every product carries (the-count-and-total-are-required) …
    await userEvent.type(canvas.getByTestId("restock-total-price-1"), "65000", { delay: 20 });

    // … but no note, no save.
    await expect(canvas.getByTestId("submit-restock")).toBeDisabled();
    await waitFor(() => expect(canvas.getByTestId("restock-form-missing-newLineNote")).toBeInTheDocument());

    await userEvent.type(canvas.getByTestId("restock-line-1-note"), "ada di dalam paket", { delay: 20 });

    await waitFor(() => expect(canvas.getByTestId("submit-restock")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("submit-restock"));
    // Reached by a link (no screen opened it), so the save lands on the list (a-form-returns-where-it-was-opened).
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
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

    // Reached by a link, so back is the list (a-form-returns-where-it-was-opened).
    await userEvent.click(canvas.getByTestId("restock-not-editable-back"));
    await canvas.findByTestId("at-restock-list");
  },
};

// EVERY FIELD IS STORED (00024, restock stage 1–3): the form carries no "not implemented" mark and no strip. A mark
// that comes back is a field that stopped being kept — this fails the day it does.
export const NothingIsMarkedNotImplemented: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(canvas.queryAllByTestId(/^not-implemented-/)).toHaveLength(0);
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

// ── Opened from a product's page (a-product-page-opens-the-order-and-restock-forms) ─────────────────────────────────

// Beras's own page opened this form with Gudang Pusat picked — the product and the warehouse in the address, and the
// page in the navigation's state.
const FromProductPage = routedPage(
  [
    { path: "/inventories/restock/new", element: <RestockFormPage key="create" /> },
    marker("/products/:productId", "at-product-page"),
  ],
  { pathname: "/inventories/restock/new", search: `?product=${BERAS}&warehouse=11`, state: { from: `/products/${BERAS}` } },
);

// THE PRODUCT IS THE FIRST LINE, and Back returns to the page that opened the form.
export const OpenedFromAProductPageStartsWithIt: Story = {
  render: () => <FromProductPage />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await waitFor(() => expect(canvas.getByTestId("restock-line-0")).toHaveTextContent("Beras Pandan Wangi 5kg"), {
      timeout: 4000,
    });
    await userEvent.click(canvas.getByTestId("restock-create-back"));
    await canvas.findByTestId("at-product-page");
  },
};

// ── The screen rules (the-restock-form-follows-the-screen-rules) ─────────────────────────────────────────────────

// THE ORDER ID, AN EXAMPLE IN EVERY TYPED FIELD, AND A LIMITED ONE'S COUNT — the store's reference reads Order ID
// (the-store-reference-is-the-order-id), its field and the tracking number show an example (every-form-field-shows-an-example),
// and each limited field says how much of its limit is used (a-limited-field-shows-its-count).
export const EveryFieldShowsAnExampleAndItsCount: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const orderId = canvas.getByTestId("restock-invoice-ref");

    await expect(canvas.getByText("Order ID")).toBeVisible();
    await expect(orderId).toHaveAttribute("placeholder", expect.stringMatching(/^Example: /));
    await expect(canvas.getByTestId("restock-receipt")).toHaveAttribute("placeholder", expect.stringMatching(/^Example: /));
    await expect(canvas.getByTestId("restock-note")).toHaveAttribute("placeholder", expect.stringMatching(/^Example: /));
    await expect(canvas.getByTestId("restock-line-0-note")).toHaveAttribute("placeholder", expect.stringMatching(/^Example: /));

    await expect(canvas.getByTestId("restock-invoice-ref-count")).toHaveTextContent(`${ONGOING.invoiceRefId.length}/100`);
    await expect(canvas.getByTestId("restock-receipt-count")).toHaveTextContent(`${ONGOING.receipt.length}/100`);
    await expect(canvas.getByTestId("restock-note-count")).toHaveTextContent(`${ONGOING.note.length}/1000`);
    await expect(canvas.getByTestId("restock-line-0-note-count")).toHaveTextContent(/\/200$/);

    await userEvent.clear(orderId);
    await userEvent.type(orderId, "INV-7", { delay: 30 });
    await expect(canvas.getByTestId("restock-invoice-ref-count")).toHaveTextContent("5/100");
  },
};

// NO LINES IS A HINT WITH THE PICKER IN IT (an-empty-list-shows-a-hint) — one way to add while the card is empty; once a
// product is picked the hint goes and the picker moves to the card's title.
export const NoLinesIsAHintWithThePicker: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const hint = canvas.getByTestId("restock-no-products");

    await expect(within(hint).getByTestId("restock-pick-products")).toBeVisible();
    // The full-size hint (owner: *"card belum ada produk pilih produk sedikit lebih tinggi heightnya"*,
    // an-empty-produk-is-the-full-size-hint) — it was the small one, 186px.
    await expect(hint.getBoundingClientRect().height).toBeGreaterThan(240);
    await expect(canvas.getAllByTestId("restock-pick-products")).toHaveLength(1);

    await pickProducts(canvas, [BERAS]);
    await waitFor(() => expect(canvas.queryByTestId("restock-no-products")).toBeNull());
    await expect(canvas.getByTestId("restock-pick-products")).toBeVisible();
  },
};

// BUAT CARRIES A PLUS, SIMPAN A DISK (an-action-button-carries-its-icon) — as the product form's.
export const CreateCarriesAPlus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await expect(within(canvas.getByTestId("submit-restock")).getByTestId("submit-restock-create-icon")).toBeInTheDocument();
  },
};

export const SaveCarriesADisk: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(within(canvas.getByTestId("submit-restock")).getByTestId("submit-restock-save-icon")).toBeInTheDocument();
  },
};

// THE LINES ARE ROWS OF THE PRODUK CARD (never a card inside a card) — no border of their own, a rule between them.
export const TheLinesAreRowsNotCards: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const line = await canvas.findByTestId("restock-line-0");

    await expect(getComputedStyle(line).borderTopWidth).toBe("0px");
    await expect(line.parentElement!.querySelector(".chakra-separator, [role='separator'], hr")).not.toBeNull();

    // A line's note is a textarea, two rows to start (owner: *"catatan produk jadi textarea tingginya default 2"*,
    // a-line-note-is-two-rows).
    const note = canvas.getByTestId("restock-line-0-note");
    await expect(note.tagName).toBe("TEXTAREA");
    await expect(note).toHaveAttribute("rows", "2");
  },
};

// THE PICKER'S PAGER IS ONE NUMBER (owner: *"paginasi di modal simpel saja"*, then *"aku ga mau yang num of num, nomor
// saja, ui mirip yang sudah pernah dibuat"*, a-dialog-pager-is-one-number) — ‹ [1] › in the app's pager boxes, the page
// in the main tone; never "1 of 1"; always on screen, the next arrow off on the last page.
export const ThePickerPagerIsOneNumber: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await userEvent.click(canvas.getByTestId("restock-pick-products"));
    const dialog = within(await screen.findByTestId("product-picker-dialog", {}, { timeout: 4000 }));
    await waitFor(() => expect(dialog.getAllByTestId(/^product-picker-option-/)).toHaveLength(3));

    const pager = dialog.getByTestId("product-picker-pager");
    await expect(pager).toBeVisible();
    await expect(pager).toHaveTextContent(/^1$/);
    await expect(dialog.getByTestId("product-picker-pager-page-1")).toHaveAttribute("aria-current", "page");
    await expect(dialog.getByTestId("product-picker-pager-next")).toBeDisabled();
  },
};

// ── One supplier for all (one-supplier-for-all-in-two-steps) ───────────────────────────────────────────────────────

const ALL_OPEN = "restock-all-supplier-picker";

// THE SUPPLIER LEADS THE CARD, FROM THE START (owner: *"supplier jadikan semacam div sendiri, 1 section pilih produk dan
// supplier, supplier di atas dan muncul dari awal"*, the-supplier-leads-the-produk-card) — and THEN the products, under a
// rule, with Pilih Produk in their own title (the-card-is-supplier-then-produk). The supplier's line — optional, for all or
// per product — stays when one is picked. Two steps: Pilih Supplier → a pick; products picked after follow it, and so do
// lines already there.
export const OneSupplierForAllInTwoSteps: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const block = canvas.getByTestId("restock-all-supplier");

    // On screen with nothing picked, ABOVE the rule, and the rule above the products and their Pilih Produk.
    const after = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const rule = canvas.getByTestId("restock-supplier-products-rule");
    await expect(block).toBeVisible();
    await expect(canvas.getByTestId("restock-all-supplier-none")).toBeVisible();
    await expect(canvas.getByTestId("restock-all-supplier-help")).toHaveTextContent(/^Every product needs a supplier/);
    await expect(after(block, rule)).toBe(true);
    await expect(after(rule, canvas.getByTestId("restock-no-products"))).toBe(true);
    await expect(after(rule, canvas.getByTestId("restock-pick-products"))).toBe(true);

    // A product already there follows the pick …
    await pickProducts(canvas, [BERAS]);
    await canvas.findByTestId("restock-line-0");

    // Step one, step two.
    const field = canvas.getByTestId("restock-all-supplier-field");
    const emptyHeight = field.getBoundingClientRect().height;
    await userEvent.click(canvas.getByTestId(`${ALL_OPEN}-trigger`));
    await connectSupplier(ALL_OPEN, "Cahaya", CAHAYA.id, CAHAYA_STORE);

    await waitFor(() => expect(canvas.getByTestId("restock-all-supplier-shown")).toHaveTextContent(CAHAYA.name), {
      timeout: 4000,
    });
    await expect(canvas.queryByTestId(`${ALL_OPEN}-trigger`)).toBeNull();
    // ONE HEIGHT, PICKED OR NOT (owner: *"buat tingginya sama ketika select dan tidak suppliernya"*) — and the picked
    // supplier's two lines fit inside it.
    await expect(field.getBoundingClientRect().height).toBe(emptyHeight);
    const shown = canvas.getByTestId("restock-all-supplier-shown").getBoundingClientRect();
    const box = field.getBoundingClientRect();
    await expect(shown.top).toBeGreaterThanOrEqual(box.top);
    await expect(shown.bottom).toBeLessThanOrEqual(box.bottom);
    // The line that says what the choice does is still there.
    await expect(canvas.getByTestId("restock-all-supplier-help")).toBeVisible();
    await expect(after(rule, canvas.getByTestId("restock-pick-products"))).toBe(true);
    await expect(canvas.getByTestId("restock-line-0-supplier-shown")).toHaveTextContent(CAHAYA.name);
    await expect(canvas.getByTestId("restock-line-0-supplier-follows")).toHaveTextContent("Same as all");

    // … and so does every product picked after.
    await pickProducts(canvas, [TEPUNG, KECAP]);
    for (const i of [1, 2]) {
      await waitFor(() => expect(canvas.getByTestId(`restock-line-${i}-supplier-shown`)).toHaveTextContent(CAHAYA.name));
      await expect(canvas.getByTestId(`restock-line-${i}-supplier-follows`)).toBeInTheDocument();
    }
  },
};

// A LINE CAN STILL PICK ITS OWN — and keeps it when the supplier for all changes; Ikut Semua takes it back, and clearing
// the supplier for all leaves the lines that followed it connected to nothing.
export const ALineKeepsItsOwnSupplierUnderTheOneForAll: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await pickProducts(canvas, [BERAS, TEPUNG, KECAP]);
    await canvas.findByTestId("restock-line-2");
    await userEvent.click(canvas.getByTestId(`${ALL_OPEN}-trigger`));
    await connectSupplier(ALL_OPEN, "Cahaya", CAHAYA.id, CAHAYA_STORE);
    await waitFor(() => expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent(CAHAYA.name));

    // Kecap was bought at a stall.
    await userEvent.click(canvas.getByTestId("restock-line-2-picker-trigger"));
    await connectSupplier("restock-line-2-picker", "Sinar", SINAR.id);
    await waitFor(() => expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent(SINAR.name));
    await expect(canvas.queryByTestId("restock-line-2-supplier-follows")).toBeNull();

    // The supplier for all changes: the lines that follow it move, Kecap stays at the stall.
    await userEvent.click(canvas.getByTestId("restock-all-supplier-change-trigger"));
    await connectSupplier("restock-all-supplier-change", "Sumber", SUMBER.id, SUMBER_SHOPEE);
    await waitFor(() => expect(canvas.getByTestId("restock-line-0-supplier-shown")).toHaveTextContent(SUMBER.name));
    await expect(canvas.getByTestId("restock-line-1-supplier-shown")).toHaveTextContent(SUMBER.name);
    await expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent(SINAR.name);

    // Ikut Semua takes it back.
    await userEvent.click(canvas.getByTestId("restock-line-2-supplier-follow"));
    await waitFor(() => expect(canvas.getByTestId("restock-line-2-supplier-shown")).toHaveTextContent(SUMBER.name));
    await expect(canvas.getByTestId("restock-line-2-supplier-follows")).toBeInTheDocument();

    // Cleared, the lines that followed it are connected to nothing, and Pilih Supplier is back.
    await userEvent.click(canvas.getByTestId("restock-all-supplier-clear"));
    await expect(canvas.getByTestId("restock-all-supplier-none")).toBeVisible();
    for (const i of [0, 1, 2]) {
      await expect(canvas.getByTestId(`restock-line-${i}-supplier-shown`)).toHaveTextContent("Not chosen yet");
    }
    await expect(canvas.getByTestId(`${ALL_OPEN}-trigger`)).toBeVisible();
  },
};

/** 501 with every line bought from Cahaya's site — for the edit that opens with a supplier for all. */
function ongoingFromOneSupplier() {
  const saved = ONGOING.items;
  ONGOING.items = saved.map((l) => ({ ...l, supplierId: CAHAYA.id, supplierChannelId: CAHAYA_STORE }));
  resetRestockStub();

  return () => {
    ONGOING.items = saved;
    resetRestockStub();
  };
}

// AN EDIT WHOSE LINES SHARE ONE SUPPLIER OPENS WITH IT as the supplier for all, every line following; lines that differ
// open without one, each keeping its own.
export const AnEditFromOneSupplierOpensWithIt: Story = {
  render: () => <EditOngoing />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("restock-all-supplier-shown")).toHaveTextContent(CAHAYA.name), {
      timeout: 4000,
    });
    for (const i of [0, 1, 2]) {
      await expect(canvas.getByTestId(`restock-line-${i}-supplier-follows`)).toBeInTheDocument();
    }
  },
};

export const AnEditFromSeveralSuppliersOpensWithout: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await canvas.findByTestId("restock-line-2");
    await expect(canvas.getByTestId("restock-all-supplier-none")).toBeVisible();
    await expect(canvas.queryByTestId("restock-line-0-supplier-follows")).toBeNull();
    await expect(canvas.getByTestId(`${ALL_OPEN}-trigger`)).toBeVisible();
  },
};

// THE WAREHOUSE OVER THE PAYMENT, THE NOTE OVER BUAT RESTOK (owner: *"gudang taruh di atas pembayaran dan paket, catatan
// taruh di atas buat restok"*, the-note-sits-over-buat-restok) — the note is the last thing written, between the total and
// the button, in the money column.
export const TheNoteSitsOverBuatRestok: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const after = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const money = canvas.getByTestId("restock-form-money");

    await expect(after(canvas.getByTestId("restock-warehouse"), canvas.getByTestId("restock-finance-account"))).toBe(true);

    await expect(money).toContainElement(canvas.getByTestId("restock-note"));
    await expect(after(canvas.getByTestId("restock-summary"), canvas.getByTestId("restock-note"))).toBe(true);
    await expect(after(canvas.getByTestId("restock-note"), canvas.getByTestId("submit-restock"))).toBe(true);
  },
};

// READY, OR THE ONE THING IT WAITS FOR, IN ONE LINE OVER BUAT RESTOK (owner: *"catatan di bawah buat tidak butuh, atau buat
// lebih bagus sebelum buat restok, tapi jangan makan tempat"*, then *"aku ingin info 1 aja ditampilkan yang belum saja,
// kalau sudah semua berarti ada tanda siap, masih bisa didetailkan"*, a-save-button-says-what-it-waits-for) — the first
// missing part, the rest behind +3 more; nothing under the button. (The ready mark: TheChecksRunProductsWarehouseAccountResi.)
export const WhatIsMissingIsOneLineOverBuat: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const missing = canvas.getByTestId("restock-form-missing");
    const button = canvas.getByTestId("submit-restock");

    await expect(button).toBeDisabled();
    await expect(missing).toHaveTextContent("Not filled in: products");
    await expect(canvas.getByTestId("restock-form-missing-more")).toHaveTextContent("+3 more");
    await expect(missing.getBoundingClientRect().bottom).toBeLessThanOrEqual(button.getBoundingClientRect().top);
    await expect(missing.getBoundingClientRect().height).toBeLessThan(24);
    // Nothing under the button.
    await expect(button.parentElement!.lastElementChild).toBe(button);

    // The detail, on asking.
    await userEvent.click(canvas.getByTestId("restock-form-missing-more"));
    const detail = await screen.findByTestId("restock-form-missing-detail");
    await waitFor(() => expect(detail).toBeVisible());
    await expect(detail).toHaveTextContent(/products.*warehouse.*paying account.*tracking number/);
  },
};

// THE SUMMARY'S PRODUCTS FOLD (owner: *"rincian produk di kanan bisa di collapse"*, the-summary-folds-its-products) — open
// to start; the heading folds the list away and opens it again, the money staying put.
export const TheSummaryFoldsItsProducts: Story = {
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const toggle = await canvas.findByTestId("restock-summary-toggle");

    await waitFor(() => expect(canvas.getByTestId("restock-summary-lines")).toBeVisible());

    await userEvent.click(toggle);
    await waitFor(() => expect(canvas.queryByTestId("restock-summary-lines")).not.toBeVisible());
    await expect(canvas.getByTestId("restock-summary-count")).toHaveTextContent("3");
    await expect(canvas.getByTestId("restock-summary-total")).toBeVisible();

    // Unfolding, the list cannot scroll until the box has finished growing — no scrollbar flashes through the
    // animation (owner: *"collapse muncul scrollbar dan mengganggu"*, the-summary-folds-without-a-scrollbar).
    await userEvent.click(toggle);
    const list = await canvas.findByTestId("restock-summary-lines");
    await expect(getComputedStyle(list).overflowY).toBe("hidden");
    await waitFor(() => expect(getComputedStyle(list).overflowY).toBe("auto"));
    await expect(list).toBeVisible();
  },
};

/** 501 cut to its first product — Beras, bought from PT Sumber Makmur's Shopee store. */
function ongoingWithOneProduct() {
  const saved = ONGOING.items;
  ONGOING.items = saved.slice(0, 1);
  resetRestockStub();

  return () => {
    ONGOING.items = saved;
    resetRestockStub();
  };
}

// AN EDIT OF ONE PRODUCT OPENS WITH ITS SUPPLIER on top (owner: *"aku lihat di dev belum begitu … maksudku untuk supplier
// paling atas sendiri"*, an-edit-opens-with-its-one-supplier) — one product is "all of them", so the supplier part is not
// left empty; the product follows it.
export const AOneProductEditOpensWithItsSupplier: Story = {
  render: () => <EditOngoing />,
  beforeEach: ongoingWithOneProduct,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("restock-all-supplier-shown")).toHaveTextContent(SUMBER.name), {
      timeout: 4000,
    });
    await expect(canvas.getByTestId("restock-all-supplier-shown")).toHaveTextContent("Sumber Makmur Official");
    await expect(canvas.getByTestId("restock-line-0-supplier-follows")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-line-1")).toBeNull();
  },
};

// ── Back and Save return where the form was opened (a-form-returns-where-it-was-opened) ──────────────────────────

function editOpenedFrom(from: string) {
  return routedPage(
    [
      { path: "/inventories/restock/:requestId/edit", element: <RestockFormPage key="edit" /> },
      marker("/inventories/restock/:requestId", "at-restock-detail"),
      marker("/inventories/restock", "at-restock-list"),
    ],
    { pathname: `/inventories/restock/${ONGOING.id}/edit`, state: { from } },
  );
}

const EditFromList = editOpenedFrom("/inventories/restock?status=ongoing");
const EditFromDetail = editOpenedFrom(`/inventories/restock/${ONGOING.id}`);

// OPENED FROM THE LIST, BACK TO THE LIST (owner: *"untuk navigasi edit bukan ke detail, tapi sesuai halaman sebelumnya,
// kalau detail ke detail, kalau list ke list"*) — Save goes back there, its filter kept.
export const AnEditFromTheListSavesBackToTheList: Story = {
  render: () => <EditFromList />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("submit-restock")).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("submit-restock"));
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};

// …and the arrow back goes there too.
export const AnEditFromTheListGoesBackToTheList: Story = {
  render: () => <EditFromList />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await userEvent.click(canvas.getByTestId("restock-edit-back"));
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};

// OPENED FROM THE RESTOCK'S PAGE, BACK TO IT.
export const AnEditFromTheDetailSavesBackToTheDetail: Story = {
  render: () => <EditFromDetail />,
  beforeEach: ongoingFromOneSupplier,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await waitFor(() => expect(canvas.getByTestId("submit-restock")).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("submit-restock"));
    await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 });
  },
};
