import { useMemo } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { RouterProvider, createMemoryRouter, useParams } from "react-router-dom";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { bundleFixture } from "../../../.storybook/bundleFixtures";
import { orderDrafts, orders, products, receiptLabel, receiptLabelFile, shops, users } from "../../../.storybook/fixtures";
import { asTeam } from "../../../.storybook/pageStory";
import { withProductState } from "../../../.storybook/productScenario";
import {
  asRole,
  orderKeyScenario,
  receiptCheckScenario,
  takeRefusalScenario,
  withTakeRefusal,
} from "../../../.storybook/sessionScenario";
import {
  duplicateRefScenario,
  withFailingRefLookup,
  withRefDrafts,
  withRefOrders,
} from "../../../.storybook/duplicateRefStub";
import { seedReturnMap } from "../../../.storybook/returnConfigurationStub";
import { closeShopForStory } from "../../../.storybook/shopStub";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderTransactionRefusalReason } from "../../gen/warehouse/inventory/v1/order_transaction_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiah } from "../../lib/money";
import { formatUnixDate, todayDateInput } from "../../lib/datetime";
import { OrderCreatePage } from "./index";

// The FIRST page storied, rather than another shared component — and the reason is that this screen
// is where stock leaves the building. Placing an order draws its goods out of the chosen warehouse in
// the same transaction that writes it, so the rules below are not form polish: they are what stops an
// order being taken for goods that are not there.
//
// ⚠ THIS STORY BUILDS ITS OWN ROUTER, via `parameters: { dataRouter: true }`.
//
// The page's unsaved-work guard is `useBlocker`, which needs a DATA router — the global
// `<MemoryRouter>` in .storybook/preview.tsx has no data-router context and the hook throws. Nesting
// one router inside another is refused by react-router, so the decorator stands down entirely and the
// routes below are the app's, cut down to the four this page can reach.

const routes = [
  { path: "/order-create", element: <OrderCreatePage /> },
  // The three destinations, stubbed as markers. A story asserts it ARRIVED — pulling in the real
  // orders list would make this a test of that page's queries instead.
  { path: "/orders", element: <Text data-testid="at-orders">Orders</Text> },
  // Carries the id it was opened for, so a story can tell a promoted draft (902) from a new order (900).
  { path: "/orders/:orderId", element: <OrderDetailMarker /> },
  // Where a saved draft, and a deleted one, go: the drafts list (the-draft-opens-in-the-order-form).
  { path: "/order-drafts", element: <Text data-testid="at-drafts">Drafts</Text> },
];

function OrderDetailMarker() {
  const { orderId } = useParams();

  return (
    <Text data-testid="at-order-detail" data-order={orderId}>
      Order detail
    </Text>
  );
}

// ⚠ MEMOISED. Storybook calls `render` on every re-render, so building the router inline would hand
// the page a fresh one each time — and with it a fresh history, resetting the navigation this file
// exists to assert on.
function RoutedOrderCreate() {
  const router = useMemo(() => createMemoryRouter(routes, { initialEntries: ["/order-create"] }), []);

  return <RouterProvider router={router} />;
}

const meta = {
  title: "Pages/Order/OrderCreate",
  component: OrderCreatePage,
  parameters: {
    // `useTeam()` throws outside a TeamProvider, and this page reads the current team on every path.
    signedIn: true,
    // See the note above — the page cannot mount under the shared MemoryRouter.
    dataRouter: true,
    layout: "fullscreen",
  },
  render: () => <RoutedOrderCreate />,
} satisfies Meta<typeof OrderCreatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// THE SAME FORM, ON A PHONE-SHAPED CANVAS (owner) — the first of the order screens to get one.
//
// It is the same page and the same data: only the canvas is narrow, which is what the form's own
// responsive rules answer to. Worth looking at here, in this order:
//
//   - the two columns collapse into one, so "which shop / which warehouse" no longer sits beside the
//     lines it governs — it sits ABOVE them, which is the reading order the design wanted anyway;
//   - the totals card stops being a sticky right rail and lands at the bottom, after the lines;
//   - every picker's option rows are 44px here against 36px on a desktop (theme.ts, OPTION_PY), and a
//     product row's controls stack rather than squeeze.
//
// ⚠ NO `play()`, DELIBERATELY. The `viewport` global resizes the WORKBENCH canvas only — the story
// runner has one fixed viewport (see MobileLayout.stories) — so an assertion written here would be
// making a claim about a width the test never renders at. This story is for looking.
//
// The shell around it on a real phone (the compact top bar, the bottom tab bar) is its own story:
// Layouts/Mobile/AppShell. What this one shows is the PAGE inside that shell.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Two products, a name and a shop — the smallest order this form will accept. Reused by the rules
// that need a placeable order rather than an empty form.
async function pickProduct(canvasElement: HTMLElement, productId: bigint) {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-create-add-line"));

  const option = await screen.findByTestId(`product-picker-option-${productId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);

  await userEvent.click(await screen.findByTestId("product-picker-confirm"));
}

// THE COURIER — required to place (no-order-without-a-courier, the-courier-required-look-is-accepted): Create is held
// until one is picked. JNE, off the shared channel catalogue.
async function pickCourier(canvasElement: HTMLElement, code = "jne") {
  const canvas = within(canvasElement);

  await userEvent.click(within(canvas.getByTestId("shipment-channel-select")).getByRole("combobox"));
  const option = await screen.findByTestId(`shipment-channel-option-${code}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// A DRAFT'S LINES ARE MAPPED HERE (a-draft-stores-no-mapping): the form seeds none, so the person picks our product —
// Toko Melati's own Beras (74), which Gudang Pusat holds.
async function mapDraftLines(canvasElement: HTMLElement) {
  await pickProduct(canvasElement, 74n);
  await waitFor(() => expect(within(canvasElement).getByTestId("order-line-0")).toBeInTheDocument());
}

// THE MARKETPLACE'S ORDER DATE — required to place (platform-created-at-is-required-at-finalize). Picked off the
// calendar the way a person picks it: the trigger opens it, today's cell sets the day (at 00:00), Escape closes it.
async function pickOrderDate(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-create-order-date"));

  const content = await screen.findByTestId("order-create-order-date-content");
  await waitFor(() => expect(content).toBeVisible());

  const today = content.querySelector<HTMLElement>(`[data-part="table-cell-trigger"][data-value="${todayDateInput()}"]`);
  await userEvent.click(today!);
  await userEvent.keyboard("{Escape}");
}

// THE SELL PRICE — what the buyer paid on the storefront, required to place (platform-total-is-required-at-finalize).
// Comfortably over what one Kopi costs us (18.500 + the 2.000 fee), so no margin warning stands between Create and
// the order.
async function fillSellPrice(canvasElement: HTMLElement, amount = "50000") {
  const canvas = within(canvasElement);

  await userEvent.type(canvas.getByTestId("order-marketplace-total"), amount, { delay: 10 });
}

// THE MARKETPLACE REF — required to place (an-order-ref-is-required-by-the-rpc). PASTED, as a ref usually arrives: one
// change to the box rather than a re-render of the whole form per keystroke.
async function fillOrderRef(canvasElement: HTMLElement, ref = "260101AAAA0001") {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-external-ref-id"));
  await userEvent.paste(ref);
}

// THE WAREHOUSE ARRIVES PRE-FILLED, from the team's configured default (#145) — and the picker is
// therefore usable on first paint. A default the SYSTEM invents would move real goods out of the
// wrong building; a default the TEAM configured is the team stating where it ships from.
export const WarehousePrefilledFromTheTeamDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // "Pick a warehouse first" is the hint shown beside the disabled picker. Its ABSENCE is the
    // assertion: the pre-fill landed, so nothing is waiting on the person.
    await waitFor(() => expect(canvas.queryByTestId("order-create-need-warehouse")).toBeNull());
    await expect(canvas.getByTestId("order-create-add-line")).toBeEnabled();
  },
};

// The form starts EMPTY — no placeholder line. Lines arrive by picking products, so a blank row would
// be one you can neither remove nor use (#165). Create is what refuses an order with nothing on it.
export const StartsWithNoLinesAndCannotBeCreated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-create-no-products")).toBeInTheDocument();
    await expect(canvas.queryByTestId("order-lines-table")).toBeNull();
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// Picking reconciles the WHOLE ticked set into lines, and each line reads its stock and its HPP from
// the chosen warehouse — one batched read for all of them, not one per line.
export const PickingProductsAddsALineWithStockAndHpp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickProduct(canvasElement, products[0]!.id);

    await waitFor(() => expect(canvas.getByTestId("order-lines-table")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-line-0")).toHaveTextContent(products[0]!.name);
    // 40 on the shelf, from the fixtures — the figure is the warehouse's, not the catalogue's.
    await waitFor(() => expect(canvas.getByTestId("order-line-stock-0")).toHaveTextContent("40"));
  },
};

// ⚠ THE RULE THIS PAGE EXISTS FOR. A line the warehouse cannot fill is summarised at the TOP as well
// as marked on the row, because on a long order the failing line is off screen — and "Create is
// disabled and I cannot see why" is the state this form must never be in.
export const AShortLineIsAnnouncedAtTheTopAndBlocksCreate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Fixture product 72 has THREE on the shelf.
    await pickProduct(canvasElement, products[1]!.id);
    await waitFor(() => expect(canvas.getByTestId("order-line-qty-0")).toBeInTheDocument());

    const qty = canvas.getByTestId("order-line-qty-0");
    await userEvent.clear(qty);
    await userEvent.type(qty, "5", { delay: 40 });

    await waitFor(() => expect(canvas.getByTestId("order-create-short")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// THERE IS NO SAVE AS DRAFT (a-draft-becomes-an-order-through-order-create): a person never drafts — only the
// third-party app does — so the form has Create alone.
export const TheFormHasNoSaveAsDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await expect(canvas.queryByTestId("order-create-save-draft")).toBeNull();
    // No shop, no lines — Create is still right to refuse.
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// A half-typed order is real work — several lines, an address, a customer on the phone — and a
// mis-aimed click on Back threw all of it away silently. The guard only fires while the form is
// DIRTY, so "opened it, changed my mind" is untouched.
export const LeavingWithUnsavedWorkAsksFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("order-create-back"));

    // Blocked: the dialog is up and the page is still here.
    await expect(await screen.findByTestId("confirm-action")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-create-page")).toBeInTheDocument();
  },
};

// …and confirming lets it through. The other half of the rule: a guard that cannot be dismissed is a
// trap rather than a safety net.
export const ConfirmingTheDiscardLeaves: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("order-create-back"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await waitFor(() => expect(screen.getByTestId("at-orders")).toBeInTheDocument());
  },
};

// The successful path, end to end — and the last line is the one that matters. `savedRef` is set
// BEFORE the navigation, so the guard above does not ask whether to discard the order that was just
// placed. That is not hypothetical: it is what happened the first time this shipped.
export const PlacingTheOrderNavigatesWithoutAskingToDiscard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    // ShopSelect renders INLINE (it has to work inside modal Dialogs), so its options are in the
    // canvas rather than a portal.
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickCourier(canvasElement);

    // Product 71: 40 on the shelf against a quantity of 1, so nothing is short.
    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    // No discard dialog on the way out.
    await expect(screen.queryByTestId("confirm-action")).toBeNull();
  },
};

// A TAKE THE WAREHOUSE REFUSES SAYS WHY (a-refusal-names-its-reason-and-every-line). The quote said the shelf had it;
// by the time Create ran, another order had taken it — the quote is advisory and the take is the authority. The
// server passes the take's refusal through (its code and its OrderTransactionRefusal detail), so the form names the
// reason and the product by the name it was picked by — never "internal", and never a bare status code. Nothing
// navigates: there is no order to go to.
export const ARefusedTakeNamesItsReasonAndTheLine: Story = {
  beforeEach: withTakeRefusal(OrderTransactionRefusalReason.NOT_ENOUGH_STOCK, [
    { productId: products[0]!.id, wanted: 1n, available: 0n },
  ]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickCourier(canvasElement);

    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    const refusal = await canvas.findByTestId("order-create-refusal");
    await expect(refusal).toHaveAttribute("data-reason", "notEnoughStock");
    await expect(refusal).toHaveTextContent("The warehouse does not hold enough for this order");
    await expect(canvas.getByTestId(`order-create-refusal-line-${products[0]!.id}`)).toHaveTextContent(
      `${products[0]!.name}: wants 1, the warehouse holds 0`,
    );

    // Not the generic line, and not a status code.
    await expect(canvas.queryByTestId("order-create-error")).toBeNull();
    await expect(refusal).not.toHaveTextContent(/internal|failed_precondition/i);
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();
  },
};

// ── WHAT THE REBUILT FORM ADDED (owner) ─────────────────────────────────────────────────────────

// ⚠ A BUNDLE'S PRODUCTS ARE REAL LINES. They are drawn from the same warehouse, judged by the same
// rule and SENT with the order — and nothing else is: the order keeps no trace of the bundle
// (the-order-keeps-only-product-lines). The short-line alert is the proof: a slot asking for more than
// the shelf holds blocks Create exactly as a hand-picked line does. If bundles were decorative, this
// would pass in silence and the totals would promise stock the order never draws.
//
// Toko Melati's own Paket Hemat (BundleList) — the CS places orders and reads the team's bundles.
const HEMAT = bundleFixture("Paket Hemat", users[0]!.id);
const DAPUR = bundleFixture("Paket Dapur");

async function addBundles(canvas: ReturnType<typeof within>, ids: string[]) {
  await userEvent.click(await canvas.findByTestId("bundle-add"));
  const dialog = await screen.findByTestId("bundle-picker-dialog");
  await waitFor(() => expect(dialog).toBeVisible());
  // The rows are the server's answer to the search, so they arrive after the dialog does.
  for (const id of ids) await userEvent.click(await within(dialog).findByTestId(`bundle-pick-${id}`, {}, { timeout: 4000 }));
  await userEvent.click(within(dialog).getByTestId("bundle-picker-confirm"));
  await waitFor(() => expect(screen.queryByTestId("bundle-picker-dialog")).toBeNull());
}

// The form opened FROM A DRAFT — `?draft=201`: three scraped lines, two of them mapped to products 71 and 72, one not.
function RoutedFromDraft() {
  const router = useMemo(() => createMemoryRouter(routes, { initialEntries: ["/order-create?draft=201"] }), []);

  return <RouterProvider router={router} />;
}

export const ABundlesProductsAreOrderedLikeAnyOther: Story = {
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-contents-bundles"));
    await addBundles(canvas, [HEMAT.id.toString()]);

    // Gula Pasir (73) has TWELVE on the shelf in the fixtures.
    const qty = await canvas.findByTestId("slot-qty-73");
    await userEvent.clear(qty);
    await userEvent.type(qty, "20", { delay: 40 });

    await waitFor(() => expect(canvas.getByTestId("order-create-short")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// A BUNDLE'S PRODUCT ITS OWNER HAS SINCE LOCKED (a-borrowed-product-never-blocks-its-owner): the bundle still has the
// line, but an order cannot take it — so its slot starts EMPTY and says why, for the CS to fill with something else.
export const ALockedProductLeavesItsSlotEmpty: Story = {
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
    withProductState(73n, { crossLocked: true })();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-contents-bundles"));
    await addBundles(canvas, [HEMAT.id.toString()]);

    const note = await canvas.findByTestId(/^slot-unavailable-.*-73$/);
    await expect(note).toHaveTextContent("Locked by its owner");
    await expect(canvas.queryByTestId("slot-qty-73")).toBeNull();
    // The usable product still went in.
    await expect(canvas.getByTestId("slot-qty-74")).toBeInTheDocument();
  },
};

// A BORROWED PRODUCT MAPPED BEFORE ARRIVES LOCKED (the-return-map-is-selling-services-and-read-by-ids). Toko Melati
// mapped Toko Kenanga's Gula Pasir (73) to its own Beras (74) on an earlier order; Paket Hemat puts Gula on this one, and
// ProductReturnMapByIds hands the pair back — named from the product read, locked, and saying where it came from.
export const ABorrowedProductMappedBeforeArrivesLocked: Story = {
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-contents-bundles"));
    await addBundles(canvas, [HEMAT.id.toString()]);

    const locked = await canvas.findByTestId("return-map-locked-73", {}, { timeout: 4000 });
    await waitFor(() => expect(locked).toHaveTextContent("Beras Pandan Wangi 5kg"));
    await expect(canvas.getByTestId("return-map-remembered-73")).toBeInTheDocument();
    await expect(canvas.queryByTestId("return-map-needs-73")).toBeNull();
    // Its own Beras is not borrowed, so it has no row at all.
    await expect(canvas.queryByTestId("return-map-74")).toBeNull();
  },
};

// THE RECEIPT FILE LEADS, AND THE TWO NUMBERS IT CARRIES SIT WITH IT (owner) — the marketplace's
// order id and the courier's tracking number are printed on one piece of paper, so they are one card
// at the top rather than two fields three cards apart. The other half of the move is that the
// customer card no longer holds a courier or a file.
export const TheReceiptFileLeadsWithBothOfItsNumbers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const receiptCard = canvas.getByTestId("order-create-receipt-preview").closest("div[class*='card__root']");
    await expect(receiptCard).not.toBeNull();
    await expect(within(receiptCard as HTMLElement).getByTestId("order-external-ref-id")).toBeInTheDocument();
    await expect(within(receiptCard as HTMLElement).getByTestId("order-receipt-code")).toBeInTheDocument();

    // The old home of the courier + upload, now empty of them.
    await expect(canvas.queryByTestId("order-receipt-section")).toBeNull();
  },
};

// ── THE LABEL, READ BACK — shipment's ReceiptCheck (receipt-check-is-shipments) ─────────────────
//
// The check runs on the FILE the person picked, beside its upload (receipt-check-takes-the-file-bytes).
// The stub answers by a marker written into the fake PDF (`receiptLabelFile`), so each story names the
// answer it is about.

async function attachReceipt(canvasElement: HTMLElement, file: File, answer: string) {
  const input = canvasElement.querySelector<HTMLInputElement>(
    '[data-testid="order-receipt-upload"] input[type="file"]',
  );
  await expect(input).not.toBeNull();
  await userEvent.upload(input as HTMLInputElement, file, { applyAccept: false });

  const canvas = within(canvasElement);
  await canvas.findByTestId("order-receipt-attached");
  // The check has ANSWERED — what makes "nothing appeared" an assertion rather than a race.
  await waitFor(() =>
    expect(canvas.getByTestId("order-create-receipt-card")).toHaveAttribute("data-scan-result", answer),
  );
}

// A label that reads fills BOTH empty boxes, and says it did: a box that filled itself looks exactly
// like one somebody typed, and only one of the two should be trusted without a second look.
export const AttachingALabelFillsItsTwoNumbers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile(), "read");

    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue(receiptLabel.orderRefId);
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue(receiptLabel.receipt);
    await expect(canvas.getByTestId("order-create-scan-filled")).toBeVisible();
    await expect(canvas.queryByTestId("order-create-scan-notice")).toBeNull();
  },
};

// ⚠ A MACHINE NEVER OVERWRITES A PERSON. The typed order id stays; only the EMPTY tracking box fills.
// The disagreement is raised at Create instead (`checkScanMatches`), where somebody can look at both.
export const ALabelNeverOverwritesWhatWasTyped: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-external-ref-id"), "260101BBBB0002", { delay: 10 });
    await attachReceipt(canvasElement, receiptLabelFile(), "read");

    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue("260101BBBB0002");
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue(receiptLabel.receipt);
  },
};

// A file that is not a courier's label SAYS so — a warning, never a refusal: the file stays attached,
// and nothing is filled from it (a-label-outcome-is-a-result-not-an-error).
export const AFileThatIsNotALabelSaysSo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile("not_shipping_label"), "notShippingLabel");

    await expect(canvas.getByTestId("order-create-scan-notice")).toHaveAttribute("data-result", "notShippingLabel");
    await expect(canvas.getByTestId("order-receipt-attached")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue("");
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue("");
  },
};

// A bulk print is read as NOTHING — never page 1, which would fill in another order's numbers.
//
// ⚠ The real ReceiptCheck does not answer `multipleLabels` yet: the reader's error for it is unexported, so a bulk print
// comes back `unknownLabel` and says nothing (docs/services/shipment_service/rpc.md). This pins what the form does the
// day it does.
export const ABulkPrintFillsNothingAndSaysWhy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile("multiple_labels"), "multipleLabels");

    await expect(canvas.getByTestId("order-create-scan-notice")).toHaveAttribute("data-result", "multipleLabels");
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue("");
  },
};

// …and a real label the reader has not learned yet says NOTHING. It is normal, not a failure: the
// person types the numbers exactly as before the check existed.
export const ALabelTheReaderDoesNotKnowSaysNothing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile("unknown_label"), "unknownLabel");

    await expect(canvas.queryByTestId("order-create-scan-notice")).toBeNull();
    await expect(canvas.queryByTestId("order-create-scan-filled")).toBeNull();
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue("");
  },
};

// TWO CHECKS ALREADY RUNNING IS "NO CHECK" (an-attached-file-is-up-to-15-mb-and-two-checks-run-at-once). The server
// refuses a third at once (ResourceExhausted), and the form treats the failed call exactly as no check at all: the
// file stays attached, nothing fills, nothing is said — no notice and no error. The person types the numbers.
export const ABusyCheckIsNoCheck: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const input = canvasElement.querySelector<HTMLInputElement>(
      '[data-testid="order-receipt-upload"] input[type="file"]',
    );
    await expect(input).not.toBeNull();
    await userEvent.upload(input as HTMLInputElement, receiptLabelFile("busy"), { applyAccept: false });

    await canvas.findByTestId("order-receipt-attached");
    // The check WAS asked, and refused — what makes "nothing appeared" an assertion rather than a race. A refusal
    // leaves no mark on the card to wait for, so the page is given a moment to show anything it was going to.
    await waitFor(() => expect(receiptCheckScenario.refused).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(canvas.getByTestId("order-create-receipt-card")).toHaveAttribute("data-scan-result", "none");
    await expect(canvas.queryByTestId("order-create-scan-notice")).toBeNull();
    await expect(canvas.queryByTestId("order-create-scan-filled")).toBeNull();
    await expect(canvas.getByTestId("order-receipt-code")).toHaveValue("");
    await expect(screen.queryByText("The receipt could not be uploaded")).toBeNull();
    await expect(screen.queryByText(/label checks/i)).toBeNull();
  },
};

// ── THE CHECKS AT CREATE (owner) ────────────────────────────────────────────────────────────────

// THE SAME NUMBER IN BOTH BOXES IS ALLOWED (the-order-id-may-be-the-tracking-number): some marketplaces use the order
// id AS the tracking number, so nothing compares the two, and the order is placed.
export const TheSameNumberInBothBoxesPlaces: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickCourier(canvasElement);

    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);

    // The same reference in both. PASTED, as a reference usually arrives: it is one change per box rather than
    // eighteen re-renders of this whole form, which kept the story inside its timeout once the sell price joined the
    // fields it fills.
    await userEvent.click(canvas.getByTestId("order-external-ref-id"));
    await userEvent.paste("JP2026081500471183");
    await userEvent.click(canvas.getByTestId("order-receipt-code"));
    await userEvent.paste("JP2026081500471183");
    await waitFor(() => expect(canvas.getByTestId("order-receipt-code")).toHaveValue("JP2026081500471183"));

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    // If anything else asks first (a thin margin), it is a WARNING with a way through. Nothing here is an error.
    const dialog = await screen.findByTestId("order-checks-dialog").catch(() => null);
    if (dialog) {
      const place = within(dialog).getByTestId("order-checks-place");
      await waitFor(() => expect(place).toBeVisible());
      await userEvent.click(place);
    }

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// …and a WARNING is the other half of the rule: a thin margin is a decision somebody is entitled to
// make, so it is shown, and then it can be overruled. The order really is placed afterwards — the
// dialog is a question, not a second Create button.
export const AThinMarginAsksFirstAndThenPlaces: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickCourier(canvasElement);

    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);

    // Sold for less than it cost — comfortably under the 35% floor.
    await userEvent.type(canvas.getByTestId("order-marketplace-total"), "1000", { delay: 10 });
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    const dialog = await screen.findByTestId("order-checks-dialog");
    await expect(within(dialog).getByTestId("order-check-profitBelowFloor")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByTestId("order-checks-place"));

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// ⚠ THE WAREHOUSE LEADS THE FORM (owner). It is not a field of the order — it is what every figure
// on the screen is measured against — so it sits in its own band above the cards. This pins the ORDER,
// because the whole point of the change is the reading order: which building → the order itself. (The strip
// saying what the screen cannot do yet sat above the band — it is gone with the last entry it listed, and
// `NothingOnTheFormIsMarkedNotImplemented` pins that.)
export const TheWarehouseLeadsTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const top = (el: HTMLElement) => el.getBoundingClientRect().top;

    const band = canvas.getByTestId("order-warehouse-band");
    const firstCard = canvas.getByTestId("order-create-receipt-preview");

    await expect(top(band)).toBeLessThan(top(firstCard));

    // …and it left the Order Information card behind: the picker is in the band, nowhere else.
    await expect(canvas.getAllByTestId("order-warehouse")).toHaveLength(1);
    await expect(band).toContainElement(canvas.getByTestId("order-warehouse"));
  },
};

// EVERY PART OF THE FORM IS WIRED (2026-10-23): the receipt file was the last, and ReceiptCheck is built
// (the-receipt-check-prototype-is-accepted). So a new order carries no strip and no mark — a mark that comes back
// is a part that stopped being real, and this fails the day it does. Even with a label read, the line that says the
// boxes filled themselves carries no ⚠. (The duplicate-ref warning's draft half held one entry for a day, until
// OrderDraftByExternalRefs was built.)
export const NothingOnTheFormIsMarkedNotImplemented: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await attachReceipt(canvasElement, receiptLabelFile(), "read");
    await expect(canvas.getByTestId("order-create-scan-filled")).toBeVisible();

    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(canvas.queryAllByTestId(/^not-implemented-/)).toHaveLength(0);
  },
};

// ── THE WAREHOUSE FEE (the-flat-rate-is-dropped-last, step 3) ──────────────────────────────────────

// THE WAREHOUSE PRICES IT, on the goods' cost (the-fee-is-priced-on-goods-cost) — the very call order create makes
// before freezing the fee, so the figure here is the one the order keeps. Gudang Pusat charges 2.5% with a floor of
// 2.000: one Kopi at an HPP of 18.500 is 462,50 by the percent, so the FLOOR is what it pays.
export const TheWarehouseFeeIsPricedByTheWarehouse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickProduct(canvasElement, products[0]!.id);

    await waitFor(() =>
      expect(canvas.getByTestId("order-create-warehouse-fee")).toHaveTextContent(formatRupiah(2000n)),
    );
  },
};

// A WAREHOUSE WITH NO RATE TAKES NO ORDERS (a-warehouse-with-no-rate-takes-no-orders): its own sentence appears under
// the picker and Create turns off — on an order that was placeable a moment earlier at the other warehouse.
export const AWarehouseWithNoRateRefusesTheOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickCourier(canvasElement);
    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await expect(canvas.queryByTestId("order-warehouse-fee-refused")).toBeNull();

    // Gudang Cabang never set its fee. TeamSelect portals, so its option is found on the screen.
    const input = within(canvas.getByTestId("order-warehouse")).getByRole("combobox");
    await userEvent.clear(input);
    await userEvent.type(input, "WH-02", { delay: 40 });
    const option = await screen.findByTestId("team-select-option-WH-02");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() =>
      expect(canvas.getByTestId("order-warehouse-fee-refused")).toHaveTextContent("has not set its fee"),
    );
    await expect(create).toBeDisabled();
  },
};

// THE MARKETPLACE'S ORDER DATE IS REQUIRED TO PLACE (platform-created-at-is-required-at-finalize): an order complete in
// every other way keeps Create off until it is set, and the field carries the red asterisk that says why. The buyer's
// username, left empty, holds nothing (the-buyers-username-is-optional).
export const TheMarketplaceOrderDateIsRequiredToPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickCourier(canvasElement);
    await pickProduct(canvasElement, products[0]!.id);
    await fillSellPrice(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(canvas.getByTestId("order-line-0")).toBeInTheDocument());
    await expect(create).toBeDisabled();

    await pickOrderDate(canvasElement);
    await waitFor(() => expect(create).toBeEnabled());
    await expect(canvas.getByTestId("order-create-buyer-username")).toHaveValue("");
  },
};

// THE SELL PRICE IS REQUIRED TO PLACE (platform-total-is-required-at-finalize) — settlement opens the order's account
// on what the buyer paid, so an order complete in every other way keeps Create off until it is filled, and the field
// carries the red asterisk that says why.
export const CreateStaysOffUntilTheSellPriceIsFilled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickCourier(canvasElement);
    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    const sell = canvas.getByTestId("order-marketplace-total");
    await waitFor(() => expect(canvas.getByTestId("order-line-0")).toBeInTheDocument());
    await expect(create).toBeDisabled();
    // A required field, as the order date is — the label carries the red asterisk.
    await expect(sell).toBeRequired();

    await fillSellPrice(canvasElement);
    await waitFor(() => expect(create).toBeEnabled());

    // Emptied again, it holds Create again.
    await userEvent.clear(sell);
    await waitFor(() => expect(create).toBeDisabled());
  },
};

// THE MARKETPLACE REF IS REQUIRED TO PLACE (an-order-ref-is-required-by-the-rpc) — the request's validation refuses an
// empty one, so an order complete in every other way keeps Create off until it is typed, and the field carries the red
// asterisk that says why. Spaces alone are still empty.
export const TheMarketplaceRefIsRequiredToPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickCourier(canvasElement);
    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    const ref = canvas.getByTestId("order-external-ref-id");
    await waitFor(() => expect(canvas.getByTestId("order-line-0")).toBeInTheDocument());
    await expect(create).toBeDisabled();
    await expect(ref).toBeRequired();

    await fillOrderRef(canvasElement, "   ");
    await expect(create).toBeDisabled();

    await userEvent.clear(ref);
    await fillOrderRef(canvasElement);
    await waitFor(() => expect(create).toBeEnabled());
  },
};

// ── THE DEBT LIMITS (the-debtor-sees-the-limits-set-on-it) ──────────────────────────────────────────────────────────

// EACH CREDITOR'S OWN LIMIT ON THIS TEAM, and the debt already carried — read by LiabilityCreditByIds, the same
// reading the create's check makes. Toko Melati ships from Gudang Pusat, which set it a 10.000.000 limit and is owed
// 8.700.000: 87%, so the row is marked NEAR beside the name. The panel's ⚠ mark is gone with the samples it flagged.
export const TheDebtLimitsAreEachCreditorsOwn: Story = {
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const meter = await canvas.findByTestId("credit-meter-11", {}, { timeout: 4000 });
    await expect(meter).toHaveTextContent(`${formatRupiah(8_700_000n)} of ${formatRupiah(10_000_000n)}`);
    await expect(canvas.getByTestId("credit-meter-11-pct")).toHaveTextContent("87%");
    await expect(canvas.getByTestId("credit-warn-11")).toBeInTheDocument();

    await expect(canvas.queryByTestId("not-implemented-creditLimit")).toBeNull();
    await expect(canvas.queryByTestId("pending-row-creditLimit")).toBeNull();
  },
};

// ── THE INVOICE (the-cross-markup-belongs-to-the-product) ───────────────────────────────────────────────────────────

// EACH LINE IS CHARGED AT ITS PRODUCT'S OWN MARKUP. Toko Melati selling Gudang Pusat's Kopi: an HPP of 18.500 at the
// Kopi's own 10% is 20.350 owed to Gudang Pusat — read off the product, never a figure per team.
export const TheInvoiceChargesTheProductsOwnMarkup: Story = {
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Gudang Pusat's Kopi is on Melati's OTHER tab — it is not Melati's own catalogue.
    await waitFor(() => expect(canvas.getByTestId("order-create-add-line")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("order-create-add-line"));
    await userEvent.click(await screen.findByTestId("product-picker-tab-other"));

    const option = await screen.findByTestId(`product-picker-option-${products[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await userEvent.click(await screen.findByTestId("product-picker-confirm"));

    const row = await canvas.findByTestId("invoice-row-product-11");
    await waitFor(() => expect(row).toHaveTextContent(formatRupiah(20_350n)));
    await expect(row).toHaveTextContent(`${formatRupiah(18_500n)} at cost · 10.00% markup`);
  },
};

// ── WHAT LEAVES THE SHELF (an-order-is-costed-at-what-leaves-the-shelf) ─────────────────────────────────────────────

// Sets the quantity of the line at `index`, the way a person types it.
async function typeQuantity(canvasElement: HTMLElement, index: number, quantity: string) {
  const canvas = within(canvasElement);

  await waitFor(() => expect(canvas.getByTestId(`order-line-qty-${index}`)).toBeInTheDocument());

  const qty = canvas.getByTestId(`order-line-qty-${index}`);
  await userEvent.clear(qty);
  await userEvent.type(qty, quantity, { delay: 40 });
}

// A LINE IS COSTED AT THE BATCHES THE TAKE WOULD DRAW. Teh arrived twice — 1 at 8.000, then 2 at 9.500 — so one Teh
// costs 8.000, and two cost 1 × 8.000 + 1 × 9.500 = 17.500: the HPP reads 8.750 with the split under it, never the
// shelf's 9.000 average. Asked again of the warehouse as the quantity settles (StockTakeQuote).
export const ALineSpanningTwoBatchesShowsTheSplit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickProduct(canvasElement, products[1]!.id);
    await waitFor(() => expect(canvas.getByTestId("order-line-hpp-0")).toHaveTextContent(formatRupiah(8_000n)));
    await expect(canvas.queryByTestId("order-line-hpp-split-0")).toBeNull();

    await typeQuantity(canvasElement, 0, "2");

    await waitFor(() =>
      expect(canvas.getByTestId("order-line-hpp-split-0")).toHaveTextContent(
        `1 × ${formatRupiah(8_000n)} + 1 × ${formatRupiah(9_500n)}`,
      ),
    );
    await expect(canvas.getByTestId("order-line-hpp-0")).toHaveTextContent(formatRupiah(8_750n));
    await expect(canvas.getByTestId("order-line-total-0")).toHaveTextContent(formatRupiah(17_500n));
    await expect(canvas.getByTestId("order-create-products-total")).toHaveTextContent(formatRupiah(17_500n));
  },
};

// THE INVOICE CHARGES THE DRAW. Toko Melati selling two of Gudang Pusat's Teh owes Gudang Pusat what those two units
// cost when they leave the shelf — 17.500, the January unit and a March one — and nothing the average would make
// of them (18.000). Teh carries no markup, so the row is the goods alone.
export const TheInvoiceChargesWhatTheTakeWouldDraw: Story = {
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Gudang Pusat's Teh is on Melati's OTHER tab.
    await waitFor(() => expect(canvas.getByTestId("order-create-add-line")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("order-create-add-line"));
    await userEvent.click(await screen.findByTestId("product-picker-tab-other"));

    const option = await screen.findByTestId(`product-picker-option-${products[1]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await userEvent.click(await screen.findByTestId("product-picker-confirm"));

    await typeQuantity(canvasElement, 0, "2");

    const row = await canvas.findByTestId("invoice-row-product-11");
    await waitFor(() => expect(row).toHaveTextContent(formatRupiah(17_500n)));
    await expect(row).not.toHaveTextContent(formatRupiah(18_000n));
  },
};

// ── Items or bundles, and the bundle dialog (frada) ──────────────────────────────────────────────

// BUNDLES ARE ADDED THE WAY ITEMS ARE (owner: *"tambah bundle buat seperti item"*, bundles-are-added-like-items) — a
// Tambah Bundel button under the card's title opening a dialog: a search that also reads the slot labels, ticked rows,
// Kosongkan · Batal · Konfirmasi. Several at once; Confirm waits for a tick.
export const BundlesAreAddedLikeItems: Story = {
  // The bundles are Toko Melati's.
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("order-contents-bundles"));

    await userEvent.click(await canvas.findByTestId("bundle-add"));
    const dialog = await screen.findByTestId("bundle-picker-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    const inDialog = within(dialog);
    await expect(inDialog.getByTestId("bundle-picker-confirm")).toBeDisabled();

    // The search is the server's, and reads a bundle's products too — "tepung" finds Paket Dapur, not Paket Hemat.
    const height = dialog.getBoundingClientRect().height;
    await userEvent.type(inDialog.getByTestId("bundle-picker-search"), "tepung", { delay: 30 });
    await waitFor(() => expect(inDialog.queryByTestId(`bundle-pick-${HEMAT.id}`)).toBeNull());
    await expect(await inDialog.findByTestId(`bundle-pick-${DAPUR.id}`, {}, { timeout: 4000 })).toBeVisible();
    // A FIXED HEIGHT (a-picker-dialog-keeps-its-height) — the list narrowed, the panel did not.
    await expect(dialog.getBoundingClientRect().height).toBe(height);
    await userEvent.clear(inDialog.getByTestId("bundle-picker-search"));

    // Two at once.
    await userEvent.click(await inDialog.findByTestId(`bundle-pick-${HEMAT.id}`, {}, { timeout: 4000 }));
    await userEvent.click(await inDialog.findByTestId(`bundle-pick-${DAPUR.id}`, {}, { timeout: 4000 }));
    await userEvent.click(inDialog.getByTestId("bundle-picker-confirm"));

    await waitFor(() => expect(canvas.getAllByTestId(new RegExp(`^bundle-(${HEMAT.id}|${DAPUR.id})-\\d+$`))).toHaveLength(2));
  },
};

// AN ORDER HOLDS ITEMS OR BUNDLES, NEVER BOTH (owner: *"order create items dan bundle cuma boleh pilih salah satu"*,
// an-order-holds-items-or-bundles). One radio pill picks the card — Items first, and only that card shows. Leaving an
// empty card is immediate; leaving one that holds something asks first, and the confirm empties it.
export const AnOrderHoldsItemsOrBundles: Story = {
  // The bundles are Toko Melati's.
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("order-items-help")).toBeVisible();
    await expect(canvas.queryByTestId("bundle-add")).toBeNull();

    // An empty items card — the switch is immediate.
    await userEvent.click(canvas.getByTestId("order-contents-bundles"));
    await expect(await canvas.findByTestId("bundle-add")).toBeVisible();
    await expect(canvas.queryByTestId("order-items-help")).toBeNull();

    await addBundles(canvas, [HEMAT.id.toString()]);
    await canvas.findByTestId("slot-qty-74");

    // A card holding a bundle — the switch asks, and Cancel keeps it.
    await userEvent.click(canvas.getByTestId("order-contents-items"));
    let dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("will be removed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await expect(canvas.getByTestId("slot-qty-74")).toBeVisible();

    // …and the confirm empties it and switches.
    await userEvent.click(canvas.getByTestId("order-contents-items"));
    dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await expect(await canvas.findByTestId("order-items-help")).toBeVisible();

    await userEvent.click(canvas.getByTestId("order-contents-bundles"));
    await expect(await canvas.findByTestId("bundle-empty")).toBeVisible();
  },
};

// ── A draft opens in this form (`the-draft-opens-in-the-order-form`) ──────────────────────────────────────

// SEEDED FROM THE DRAFT — the buyer, the shop, the warehouse; NO line (a draft stores no mapping, a-draft-stores-no-mapping
// — the person picks our products); its scraped lines are a list of TEXT above the products; the header says which
// draft, with Delete Draft beside it; and there is no Save as Draft — a draft is finished here, not drafted again.
export const ADraftOpensInTheForm: Story = {
  render: () => <RoutedFromDraft />,
  // The drafts are Toko Melati's.
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Lestari"), {
      timeout: 4000,
    });
    await expect(canvas.getByTestId("order-create-draft-ref")).toHaveTextContent("Draft MEL-9001");
    await expect(canvas.getByTestId("order-create-delete-draft")).toBeVisible();
    await expect(canvas.queryByTestId("order-create-save-draft")).toBeNull();

    const hints = canvas.getByTestId("draft-product-hints");
    await expect(within(hints).getAllByRole("listitem")).toHaveLength(3);
    await expect(canvas.getByTestId("draft-product-hint-0")).toHaveTextContent("2 × Kopi Arabika Gayo 250gr Biji Sangrai");
    await expect(canvas.getByTestId("draft-product-hint-2")).toHaveTextContent("Mug Keramik Motif Batik (bonus)");
    // A hint, not a row: no table, no picker, no input inside it.
    await expect(within(hints).queryAllByRole("textbox")).toHaveLength(0);
    // In a card of its own colour — a faded sand (draftHint.bg), never a role's tint — titled, and naming the app that
    // pushed it.
    await expect(getComputedStyle(hints).backgroundColor).toBe("rgb(251, 247, 239)");
    await expect(hints).toHaveTextContent("Products to Send");
    await expect(canvas.getByTestId("draft-product-hints-source")).toHaveTextContent("From ScraperX");

    // Nothing scraped is on the order: the lines are the person's to pick.
    await expect(canvas.getByTestId("order-create-no-products")).toBeInTheDocument();
    await expect(canvas.queryByTestId("order-line-0")).toBeNull();
  },
};

// ── The draft's address (the-cs-edits-the-whole-address-before-create) ─────────────────────────────────────────────

const levelInput = (canvasElement: HTMLElement, level: string) =>
  within(within(canvasElement).getByTestId(`address-${level}`)).getByRole("combobox");

// PRE-FILLED WHEN CERTAIN: draft 201's four names ("JAWA BARAT", Kota Bandung, Sukajadi, Sukawarna) match exactly one
// place, so the dropdowns open on it — in the region list's own spelling — with the draft's postcode and street. The
// draft's address stays beside them as the marketplace's text, in the hint's sand.
export const ADraftAddressThatMatchesOnePlaceOpensPrefilled: Story = {
  render: () => <RoutedFromDraft />,
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(levelInput(canvasElement, "desa")).toHaveValue("Sukawarna"), { timeout: 4000 });
    await expect(levelInput(canvasElement, "provinsi")).toHaveValue("Jawa Barat");
    await expect(levelInput(canvasElement, "kabupaten")).toHaveValue("Kota Bandung");
    await expect(levelInput(canvasElement, "kecamatan")).toHaveValue("Sukajadi");
    await expect(within(canvas.getByTestId("address-kodepos")).getByRole("combobox")).toHaveValue("40162");
    await expect(canvas.getByTestId("address-line")).toHaveValue("Jl. Sukajadi No. 45");

    const text = canvas.getByTestId("draft-address-text");
    await expect(text).toHaveTextContent("Address from the marketplace");
    await expect(canvas.getByTestId("draft-address-text-street")).toHaveTextContent("Jl. Sukajadi No. 45");
    await expect(canvas.getByTestId("draft-address-text-place")).toHaveTextContent(
      "Sukawarna, Sukajadi, Kota Bandung, JAWA BARAT 40162",
    );
    await expect(getComputedStyle(text).backgroundColor).toBe("rgb(251, 247, 239)");
    // Text, not a field.
    await expect(within(text).queryAllByRole("textbox")).toHaveLength(0);
  },
};

// …AND STILL EDITABLE: the pre-fill is where the form starts, never a lock. Another desa of the same kecamatan is picked
// over Sukawarna, and the draft's text beside it is unchanged.
export const APrefilledAddressStaysEditable: Story = {
  render: () => <RoutedFromDraft />,
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(levelInput(canvasElement, "desa")).toHaveValue("Sukawarna"), { timeout: 4000 });

    await userEvent.click(levelInput(canvasElement, "desa"));
    const other = await screen.findByTestId("address-desa-option-3273011002");
    await waitFor(() => expect(other).toBeVisible());
    await userEvent.click(other);

    await waitFor(() => expect(levelInput(canvasElement, "desa")).toHaveValue("Sukagalih"));
    await expect(within(canvas.getByTestId("address-kodepos")).getByRole("combobox")).toHaveValue("40163");
    await expect(canvas.getByTestId("draft-address-text-place")).toHaveTextContent("Sukawarna");
  },
};

// ELSE EMPTY: draft 202's "Kab. Bandung" over Cicendo matches no place (Cicendo is Kota Bandung's — the prefix
// disagrees), so the four dropdowns open empty while the postcode and the street are seeded; the person reads the
// marketplace's text and picks, from the provinsi down.
export const ADraftAddressWithNoMatchOpensEmpty: Story = {
  render: () => <RoutedFromDraft202 />,
  beforeEach: asMelatiWithMaps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("draft-address-text-place")).toHaveTextContent(
      "Pajajaran, Cicendo, Kab. Bandung, Jawa Barat 40173",
    ), { timeout: 4000 });
    for (const level of ["provinsi", "kabupaten", "kecamatan", "desa"]) {
      await expect(levelInput(canvasElement, level)).toHaveValue("");
    }
    await expect(within(canvas.getByTestId("address-kodepos")).getByRole("combobox")).toHaveValue("40173");
    await expect(canvas.getByTestId("address-line")).toHaveValue("Jl. Pajajaran No. 12");

    await userEvent.click(levelInput(canvasElement, "provinsi"));
    const jabar = await screen.findByTestId("address-provinsi-option-32");
    await waitFor(() => expect(jabar).toBeVisible());
    await userEvent.click(jabar);
    await waitFor(() => expect(levelInput(canvasElement, "provinsi")).toHaveValue("Jawa Barat"));
    await expect(levelInput(canvasElement, "kabupaten")).toBeEnabled();
  },
};

// LEAVING AN UNTOUCHED DRAFT ASKS NOTHING — the form opened filled, but nothing was changed, and the draft is still on
// the list. Only work done here is worth a "discard?".
export const LeavingAnUntouchedDraftAsksNothing: Story = {
  render: () => <RoutedFromDraft />,
  // The drafts are Toko Melati's.
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Lestari"), {
      timeout: 4000,
    });
    await userEvent.click(canvas.getByTestId("order-create-back"));
    await waitFor(() => expect(canvas.getByTestId("at-orders")).toBeInTheDocument());
  },
};

// DELETE DRAFT CONFIRMS, then goes back to the drafts list.
export const DeletingTheDraftGoesBackToTheList: Story = {
  render: () => <RoutedFromDraft />,
  // The drafts are Toko Melati's.
  beforeEach: asTeam(12n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-create-delete-draft", {}, { timeout: 4000 }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("MEL-9001");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("at-drafts")).toBeInTheDocument());
  },
};

// ── The duplicate marketplace ref (a-duplicate-ref-is-warned-not-refused) ─────────────────────────────────────────────
//
// Before Create — a new order or a draft being finalized — the form asks OrderByExternalRefs and
// OrderDraftByExternalRefs whether this shop and ref are already recorded. A live order or a draft on them is NAMED in a
// warning with Create Anyway and Go Back; a cancelled order, another shop's, or the draft being finalized is not;
// nothing found goes straight through. The server refuses nothing for a repeated ref.
//
// ⚠ THE NEW-ORDER STORIES RUN AS THE FIRST MEMBERSHIP, Gudang Pusat (11), like every other new-order story in this
// file — the product picker's fixtures are read from there. The lookup answers only the CALLER's team's orders (the
// handler's `team_id = ?`), so each story puts the order it needs on a ref for that team: order 101 — pending, typed in
// yesterday — on SP-2409-8841 in Melati Official (shops[0]).
const STORY_TEAM = 11n;
const LIVE_REF = "SP-2409-8841";
const LIVE_ORDER = orders.find((o) => o.id === 101n)!;
const onLiveRef = withRefOrders({
  orderId: LIVE_ORDER.id,
  teamId: STORY_TEAM,
  shopId: shops[0]!.id,
  ref: LIVE_REF,
  status: OrderStatus.PENDING,
});

// Draft 202 — MEL-9002 in Melati Store, every line mapped, its date and sell price stored. Its two products are Gudang
// Pusat's, so Toko Melati needs their return maps before Create (a-borrowed-line-needs-its-map-at-create): seeded as
// standing pairs to its own Beras (74), as an earlier order would have left them.
function RoutedFromDraft202() {
  const router = useMemo(() => createMemoryRouter(routes, { initialEntries: ["/order-create?draft=202"] }), []);

  return <RouterProvider router={router} />;
}

function asMelatiWithMaps() {
  asTeam(12n)();
  seedReturnMap(12n, 71n, 74n);
  seedReturnMap(12n, 72n, 74n);
}

// Every field Create needs, the ref last — the smallest order this form will place.
async function fillPlaceableOrder(canvasElement: HTMLElement, ref: string) {
  const canvas = within(canvasElement);

  await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

  await userEvent.click(canvas.getByTestId("shop-select"));
  const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
  await waitFor(() => expect(shop).toBeVisible());
  await userEvent.click(shop);
  await pickCourier(canvasElement);

  await pickProduct(canvasElement, products[0]!.id);
  await pickOrderDate(canvasElement);
  await fillSellPrice(canvasElement);
  await fillOrderRef(canvasElement, ref);

  const create = canvas.getByTestId("order-create-save");
  await waitFor(() => expect(create).toBeEnabled());

  return create;
}

// If the order's own checks ask anything (a thin margin), it is a warning with a way through — passed here, because
// these stories are about the ref.
async function passTheChecks() {
  const checks = await screen.findByTestId("order-checks-dialog", {}, { timeout: 800 }).catch(() => null);
  if (checks) await userEvent.click(within(checks).getByTestId("order-checks-place"));
}

async function warning() {
  const dialog = await screen.findByTestId("duplicate-ref-dialog", {}, { timeout: 4000 });
  await waitFor(() => expect(dialog).toBeVisible());

  return dialog;
}

// NOTHING ON THE REF → NO DIALOG AT ALL. TK-88120347 IS recorded — order 102, in Melati STORE — but not in this shop,
// and another shop's order is not this one's double: the lookup runs once, and Create goes straight to the order.
export const NoDuplicateCreatesStraightAway: Story = {
  beforeEach: withRefOrders({ orderId: 102n, teamId: STORY_TEAM, shopId: 22n, ref: "TK-88120347", status: OrderStatus.PENDING }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "TK-88120347"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    await expect(duplicateRefScenario.calls).toEqual([["TK-88120347"]]);
    await expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull();
  },
};

// A CANCELLED ORDER ON THE REF IS NOT WARNED ABOUT — cancel and re-create is the normal path.
export const ACancelledOrderOnTheRefDoesNotWarn: Story = {
  beforeEach: withRefOrders({
    orderId: 107n,
    teamId: STORY_TEAM,
    shopId: shops[0]!.id,
    ref: "SP-2409-9999",
    status: OrderStatus.CANCEL,
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "SP-2409-9999"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    await expect(duplicateRefScenario.calls).toHaveLength(1);
    await expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull();
  },
};

// A LIVE ORDER ON THE SHOP + REF WARNS, naming it: a link to order 101 (a new tab — the form stays), its status and
// the day it was typed in (the short WIB date, straight off the lookup). Nothing is sent until the person answers.
export const ALiveOrderOnTheRefWarns: Story = {
  beforeEach: onLiveRef,
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, LIVE_REF));

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-lead")).toHaveTextContent(LIVE_REF);

    const link = within(dialog).getByTestId("duplicate-ref-order-link-101");
    await expect(link).toHaveTextContent("Order #101");
    await expect(link).toHaveAttribute("href", "/orders/101");
    await expect(link).toHaveAttribute("target", "_blank");
    const row = within(dialog).getByTestId("duplicate-ref-order-101");
    await expect(row).toHaveTextContent("Pending");
    await expect(row).toHaveTextContent(`created ${formatUnixDate(LIVE_ORDER.createdAtUnix)}`);
    await expect(within(dialog).queryAllByTestId(/^not-implemented-/)).toHaveLength(0);

    // Still here, nothing placed.
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();
  },
};

// A DRAFT ON THE REF WARNS (the-duplicate-warning-reads-drafts-too) — a colleague's scrape of MEL-9001 in Melati
// Official (draft 201's ref, put on the story's team), and no live order on it: the warning names it "A colleague's
// draft #201", dated, with NO link — only its author can open a draft; Create Anyway still places the order.
const DRAFT_201 = orderDrafts.find((d) => d.id === 201n)!;

export const ADraftOnTheRefWarns: Story = {
  beforeEach: withRefDrafts({
    draftId: 201n,
    teamId: STORY_TEAM,
    shopId: shops[0]!.id,
    ref: "MEL-9001",
    createdAtUnix: DRAFT_201.createdAtUnix,
    source: "ScraperX",
    authorUserId: 62n,
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "MEL-9001"));

    const dialog = await warning();
    const row = within(dialog).getByTestId("duplicate-ref-draft-201");
    await expect(row).toHaveTextContent("A colleague's draft #201");
    await expect(within(row).queryByRole("link")).toBeNull();
    await expect(row).toHaveTextContent(`created ${formatUnixDate(DRAFT_201.createdAtUnix)}`);
    await expect(within(dialog).queryAllByTestId(/^duplicate-ref-order-/)).toHaveLength(0);
    await expect(duplicateRefScenario.draftCalls).toEqual([{ shopId: shops[0]!.id, refs: ["MEL-9001"] }]);

    await userEvent.click(within(dialog).getByTestId("duplicate-ref-create-anyway"));
    await passTheChecks();
    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// THE CALLER'S OWN DRAFT ON THE REF — the same warning, and this one IS a link to its page (a new tab), since its author
// is the person in front of the screen.
export const YourOwnDraftOnTheRefLinks: Story = {
  beforeEach: withRefDrafts({
    draftId: 201n,
    teamId: STORY_TEAM,
    shopId: shops[0]!.id,
    ref: "MEL-9001",
    createdAtUnix: DRAFT_201.createdAtUnix,
    source: "ScraperX",
    authorUserId: users[0]!.id,
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "MEL-9001"));

    const dialog = await warning();
    const link = within(dialog).getByTestId("duplicate-ref-draft-link-201");
    await expect(link).toHaveTextContent("Draft #201");
    await expect(link).toHaveAttribute("href", "/orders/new?draft=201");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(within(dialog).queryByTestId("duplicate-ref-draft-colleague-201")).toBeNull();
  },
};

// …BUT ANOTHER SHOP'S DRAFT ON THE SAME REF IS NOT THIS ORDER'S DOUBLE — the lookup asks for this shop only.
export const AnotherShopsDraftDoesNotWarn: Story = {
  beforeEach: withRefDrafts({
    draftId: 203n,
    teamId: STORY_TEAM,
    shopId: 22n,
    ref: "MEL-9003",
    createdAtUnix: DRAFT_201.createdAtUnix,
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, "MEL-9003"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    await expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull();
  },
};

// CREATE ANYWAY GOES THROUGH — the warning is a question, not a refusal: the order is placed and opened.
export const CreateAnywayGoesThrough: Story = {
  beforeEach: onLiveRef,
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, LIVE_REF));

    const dialog = await warning();
    await userEvent.click(within(dialog).getByTestId("duplicate-ref-create-anyway"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    // No discard question on the way out.
    await expect(screen.queryByTestId("confirm-action")).toBeNull();
  },
};

// GO BACK KEEPS THE FORM — exactly as typed, and Create still offered; pressing it again asks again.
export const GoBackKeepsTheForm: Story = {
  beforeEach: onLiveRef,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const create = await fillPlaceableOrder(canvasElement, LIVE_REF);
    await userEvent.click(create);

    const dialog = await warning();
    await userEvent.click(within(dialog).getByTestId("duplicate-ref-go-back"));

    await waitFor(() => expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull());
    await expect(canvas.getByTestId("order-create-page")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Ani");
    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue(LIVE_REF);
    await expect(canvas.getByTestId("order-line-0")).toHaveTextContent(products[0]!.name);
    await expect(create).toBeEnabled();
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();

    // A second Create re-reads — the warning is asked fresh, never remembered.
    await userEvent.click(create);
    await warning();
    await expect(duplicateRefScenario.calls).toHaveLength(2);
  },
};

// A LOOKUP THAT FAILS STILL WARNS — it says the check could not run, and Create Anyway is still the person's call.
export const AFailedLookupSaysSoAndStillCreates: Story = {
  beforeEach: [onLiveRef, withFailingRefLookup()],
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, LIVE_REF));

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-failed")).toHaveTextContent(
      `Could not check whether ${LIVE_REF} is already recorded`,
    );
    await userEvent.click(within(dialog).getByTestId("duplicate-ref-create-anyway"));
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// FINALIZING A DRAFT DOES NOT WARN ABOUT ITSELF (the-duplicate-warning-reads-drafts-too). Draft 202 (MEL-9002, Melati
// Store) is ready as it stands: Create runs the check on its ref, finds nothing to name, and the draft is promoted —
// order 902 — with no dialog.
export const FinalizingADraftDoesNotWarnAboutItself: Story = {
  render: () => <RoutedFromDraft202 />,
  beforeEach: asMelatiWithMaps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), {
      timeout: 4000,
    });
    await mapDraftLines(canvasElement);
    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(create);
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toHaveAttribute("data-order", "902"));
    await expect(duplicateRefScenario.calls).toEqual([["MEL-9002"]]);
    // The draft read ran, and answered draft 202 itself — which the form dropped.
    await expect(duplicateRefScenario.draftCalls).toEqual([{ shopId: 22n, refs: ["MEL-9002"] }]);
    await expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull();
  },
};

// A WAITING DRAFT ON A CLOSED SHOP (a-close-leaves-the-drafts-waiting, the-close-shop-prototype-is-accepted): draft 202's
// Melati Store was closed. The form keeps the shop — badged, never cleared — says at the top that the shop is closed and
// what the ways out are, and holds Create; Delete Draft is still there.
export const ADraftOnAClosedShopKeepsItAndRefusesCreate: Story = {
  render: () => <RoutedFromDraft202 />,
  beforeEach: [asMelatiWithMaps, () => closeShopForStory(22n)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), {
      timeout: 4000,
    });
    await waitFor(() => expect(canvas.getByTestId("shop-select")).toHaveValue("Melati Store"), { timeout: 4000 });

    const alert = await canvas.findByTestId("order-create-shop-closed");
    await expect(alert).toHaveTextContent("Melati Store is closed");
    await expect(alert).toHaveTextContent(/Delete the draft, or ask the team's owner or admin to reopen the shop/);
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
    await expect(canvas.getByTestId("order-create-delete-draft")).toBeVisible();

    await userEvent.click(canvas.getByTestId("shop-select"));
    const kept = await canvas.findByTestId("shop-select-option-22");
    await waitFor(() => expect(kept).toBeVisible());
    await expect(within(kept).getByTestId("shop-select-closed-22")).toBeVisible();
  },
};

// …BUT ANOTHER DRAFT ON THE DRAFT'S SHOP + REF IS NAMED — a second app scraped the same order. Draft 205 (another app,
// a colleague's) is put on MEL-9002 in Melati Store; the warning names it, and never draft 202.
export const FinalizingADraftNamesAnotherDraft: Story = {
  render: () => <RoutedFromDraft202 />,
  beforeEach: [
    asMelatiWithMaps,
    withRefDrafts({
      draftId: 205n,
      teamId: 12n,
      shopId: 22n,
      ref: "MEL-9002",
      createdAtUnix: DRAFT_201.createdAtUnix,
      source: "OtherApp",
      authorUserId: 62n,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), {
      timeout: 4000,
    });
    await mapDraftLines(canvasElement);
    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(create);

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-draft-205")).toBeInTheDocument();
    await expect(within(dialog).queryByTestId("duplicate-ref-draft-202")).toBeNull();
  },
};

// …BUT A LIVE ORDER ON THE DRAFT'S REF IS NAMED — the scrape most likely already became an order. Order 102 is put on
// MEL-9002 in Melati Store; the warning names it, and not draft 202.
export const FinalizingADraftWarnsAboutALiveOrder: Story = {
  render: () => <RoutedFromDraft202 />,
  beforeEach: [
    asMelatiWithMaps,
    withRefOrders({ orderId: 102n, teamId: 12n, shopId: 22n, ref: "MEL-9002", status: OrderStatus.PROCESSED }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), {
      timeout: 4000,
    });
    await mapDraftLines(canvasElement);
    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(create);

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-order-102")).toHaveTextContent("Processed");
    await expect(within(dialog).queryByTestId("duplicate-ref-draft-202")).toBeNull();
  },
};

// ── THE ORDER'S IDEMPOTENCY KEY (backlog #10, slice 1) ─────────────────────────────────────────────────────────────
//
// The form mints a key INSIDE every submit (the-frontend-mints-the-idempotency-key, every-submit-mints-a-new-key) and
// sends it with OrderCreate; the order stores it, and a key an order already holds is refused with the take's *key
// already used* refusal (the-order-refuses-a-used-key — ⚠ the refusal's shape awaits the owner, #10 Q9).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// EVERY SUBMIT MINTS A NEW KEY — a resubmit after a refusal included. The first Create is refused at the take; the
// second, once the shelf has it, places the order. Both carried a key, and never the same one.
export const EverySubmitMintsANewKey: Story = {
  beforeEach: withTakeRefusal(OrderTransactionRefusalReason.NOT_ENOUGH_STOCK, [
    { productId: products[0]!.id, wanted: 1n, available: 0n },
  ]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const create = await fillPlaceableOrder(canvasElement, "SP-KEY-0001");
    await userEvent.click(create);
    await passTheChecks();
    await expect(await canvas.findByTestId("order-create-refusal")).toHaveAttribute("data-reason", "notEnoughStock");

    // The shelf has it now: the same form, submitted again.
    takeRefusalScenario.refusal = undefined;
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);
    await passTheChecks();
    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());

    const [first, second] = orderKeyScenario.sent;
    await expect(orderKeyScenario.sent).toHaveLength(2);
    await expect(first).toMatch(UUID);
    await expect(second).toMatch(UUID);
    await expect(second).not.toEqual(first);
  },
};

// A DRAFT'S FINALIZE MINTS ITS OWN KEY TOO — it is the same submit (a-draft-becomes-an-order-through-order-create).
export const FinalizingADraftSendsItsOwnKey: Story = {
  render: () => <RoutedFromDraft202 />,
  beforeEach: asMelatiWithMaps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Pak Mamat"), {
      timeout: 4000,
    });
    await mapDraftLines(canvasElement);
    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(create);
    await passTheChecks();

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toHaveAttribute("data-order", "902"));
    await expect(orderKeyScenario.sent).toHaveLength(1);
    await expect(orderKeyScenario.sent[0]).toMatch(UUID);
  },
};

// A USED KEY IS REFUSED, WITH THE TAKE'S *KEY ALREADY USED* MESSAGE. No honest form sends one — every submit mints its
// own — so the browser's minting is pinned to a key an order already holds, as a bug would. The server refuses it
// before anything is taken; the form shows the same alert it shows for the take's own KEY_USED, and nothing navigates.
const USED_KEY = "11111111-2222-4333-8444-555555555555";

export const AUsedKeyIsRefused: Story = {
  beforeEach: () => {
    orderKeyScenario.used = [USED_KEY];
    const minted = spyOn(crypto, "randomUUID").mockReturnValue(USED_KEY);

    return () => minted.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await fillPlaceableOrder(canvasElement, "SP-KEY-0002"));
    await passTheChecks();

    const refusal = await canvas.findByTestId("order-create-refusal");
    await expect(refusal).toHaveAttribute("data-reason", "keyUsed");
    await expect(refusal).toHaveTextContent("This order was already placed");
    await expect(refusal).not.toHaveTextContent(/already_exists|internal/i);
    await expect(canvas.queryByTestId("order-create-error")).toBeNull();
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();
    await expect(orderKeyScenario.sent).toEqual([USED_KEY]);
  },
};

// ON A PHONE — the same warning inside the screen, its two answers stacked full width with Create Anyway on top.
export const Phone: Story = {
  globals: { viewport: { value: "mobile2" } },
  beforeEach: onLiveRef,
  play: async ({ canvasElement }) => {
    await userEvent.click(await fillPlaceableOrder(canvasElement, LIVE_REF));

    const dialog = await warning();
    await expect(within(dialog).getByTestId("duplicate-ref-order-101")).toBeVisible();

    const create = within(dialog).getByTestId("duplicate-ref-create-anyway");
    const back = within(dialog).getByTestId("duplicate-ref-go-back");
    await expect(create.getBoundingClientRect().bottom).toBeLessThanOrEqual(back.getBoundingClientRect().top + 1);
    await expect(Math.abs(create.getBoundingClientRect().width - back.getBoundingClientRect().width)).toBeLessThan(1);

    const box = dialog.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1);
  },
};
