import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { bundleFixture } from "../../../.storybook/bundleFixtures";
import { orderDraftItems, teams, users } from "../../../.storybook/fixtures";
import { asRole, withTakeRefusal } from "../../../.storybook/sessionScenario";
import { OrderTransactionRefusalReason } from "../../gen/warehouse/inventory/v1/order_transaction_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { OrderDraftDetailPage } from "./index";

// THE DRAFT PAGE IN THE ORDER FORM'S CLOTHES (`the-draft-page-wears-the-order-form`) — `/order-drafts/:id`.
//
//   | story                                   | the rule it pins                                        |
//   | --------------------------------------- | ------------------------------------------------------- |
//   | Default                                 | 201 — one unmapped row: Promote refused, and says why    |
//   | TheScrapedTextStaysAboveTheMap          | the evidence is never replaced by the mapping            |
//   | TheSellPriceStartsFromTheRows           | Σ qty × MP price, typed over, reset back to the rows     |
//   | TheSellPriceIsStoredOnTheDraft          | 202 opens with its stored figure; typing over is a change |
//   | TheInvoiceChargesEachProductsOwnRate    | one owner, two products, two rates — said in rupiah      |
//   | ACountThatDiffersFromTheListingIsFlagged | listing qty/price are info; a different count is flagged  |
//   | ARowMapsToABundle                       | Bundle → the bundle's slots, and it goes on the order     |
//   | ARowSplitsAndSuggestsABundle            | Pecah → parts, and "Make It a Bundle" is offered         |
//   | AnUnsavedEditIsPromotedAsIs             | Save any state; Promote sends what is on screen           |
//   | AManualDraftAsksForItsRef               | a `manual` draft's id is no ref — typed, Promote waits    |
//   | AShortLineIsCalledOutOnTop              | one over the shelf → the alert above both columns        |
//   | AReadyDraftPromotesToAnOrder            | 202 — the form's checks, then the order                  |
//   | DeleteConfirmsThenGoesBack              | destructive → ConfirmDialog → back to the list           |
//   | AnotherTeamsDraftIsNotFound             | one side only                                            |
//   | EveryDraftGapIsMarkedOnScreen           | every draft-only ⚠ has a badge on the thing it is about   |

const SELLER = teams[1]!; // Toko Melati (12)
const OTHER_SELLER = teams[2]!; // Toko Kenanga (13)

const Routed = (path: string) =>
  routedPage(
    [
      { path: "/order-drafts/:draftId", element: <OrderDraftDetailPage /> },
      marker("/order-drafts", "at-order-drafts"),
      marker("/orders/:orderId", "at-order-detail"),
    ],
    path,
  );

const AtUnmapped = Routed("/order-drafts/201");
const AtReady = Routed("/order-drafts/202");

const meta = {
  title: "Pages/Order/OrderDraftDetailPage",
  component: OrderDraftDetailPage,
  parameters: {
    signedIn: true,
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(SELLER.id),
  render: () => <AtUnmapped />,
} satisfies Meta<typeof OrderDraftDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function ready(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("draft-detail-page")).toBeInTheDocument());
  return canvas;
}

// 202 is Toko Melati's, and both its products are Gudang Pusat's — so each needs its return map before Promote
// (a-borrowed-line-needs-its-map-at-create). Mapped through the card as a person maps it: search Melati's own
// catalogue, pick, confirm (the-map-is-written-when-it-is-picked).
async function mapForReturns(canvas: ReturnType<typeof within>, crossProductId: bigint) {
  const row = await canvas.findByTestId(`return-map-${crossProductId}`);
  // Found, not got: the picker replaces the placeholder once the standing pairs have been read.
  const input = await within(row).findByPlaceholderText("Search your products");

  await userEvent.click(input);
  await userEvent.type(input, "beras");

  const option = await screen.findByTestId("product-select-option-SKU-BERAS-5K");
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);

  const confirm = within(await screen.findByRole("alertdialog")).getByTestId("confirm-action");
  await waitFor(() => expect(confirm).toBeVisible());
  await userEvent.click(confirm);

  await waitFor(() => expect(canvas.getByTestId(`return-map-locked-${crossProductId}`)).toBeInTheDocument());
}

async function mapEveryBorrowedProduct(canvas: ReturnType<typeof within>) {
  await mapForReturns(canvas, 71n);
  await mapForReturns(canvas, 72n);
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/**
 * 201: three rows, the third unmapped. Promote is refused and the reasons sit under it. 201 stores no SELL PRICE, so
 * its field follows the rows' 155.000 — and Promote sends what is on screen
 * (a-draft-becomes-an-order-through-order-create), so that is no missing sell price. Not stored yet, it is a change:
 * Save is already on.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await expect(canvas.getByTestId("draft-line-unmapped-2")).toBeInTheDocument();
    await expect(canvas.getByTestId("draft-gaps")).toBeInTheDocument();
    await expect(canvas.getByTestId("draft-promote")).toBeDisabled();
    await expect(canvas.getByTestId("draft-gaps")).not.toHaveTextContent("The sell price is missing.");
    await expect(canvas.getByTestId("draft-gaps")).not.toHaveTextContent("Save the changes first");
    // The app's draft carries the marketplace ref, seeded into the receipt card.
    await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue("MEL-9001");
    await waitFor(() => expect(canvas.getByTestId("draft-save")).toBeEnabled());
  },
};

/** The layout without the ⚠ scaffolding. */
export const WithoutTheMarks: Story = {
  globals: { pendingMarks: "off" },
};

// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

export const Ready: Story = {
  render: () => <AtReady />,
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

export const TheScrapedTextStaysAboveTheMap: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    for (const [i, item] of orderDraftItems["201"]!.entries()) {
      await expect(canvas.getByTestId(`draft-line-scraped-${i}`)).toHaveTextContent(item.externalName);
    }
    await expect(canvas.getByTestId("draft-line-mapped-0")).toBeInTheDocument();
  },
};

/**
 * THE SELL PRICE STARTS AS THE ROWS' PLATFORM PRICES — 2 × 55.000 + 25.000 + 20.000 = 155.000 — and can
 * be typed over (owner: *"sell price masih mungkin untuk diganti"*) — down
 * to 0. Following the rows again is the reset button, never a side effect of an empty box.
 */
export const TheSellPriceStartsFromTheRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);
    const sell = canvas.getByTestId("draft-sell-price");

    await expect(sell).toHaveValue("155.000");

    // Typed over, it is the person's.
    await userEvent.clear(sell);
    await userEvent.type(sell, "150000", { delay: 20 });
    await waitFor(() => expect(sell).toHaveValue("150.000"));

    // Emptied, it is 0 — it does not snap back to the rows mid-edit.
    await userEvent.clear(sell);
    await expect(sell).toHaveValue("");

    // The reset is what follows the rows again.
    await userEvent.click(canvas.getByTestId("draft-sell-price-reset"));
    await waitFor(() => expect(sell).toHaveValue("155.000"));
  },
};

/** A ROW MAPPED TO A BUNDLE — one of the team's bundles (BundleList), its slots open under it, and Promote says it cannot take it. */
const HEMAT = bundleFixture("Paket Hemat", users[0]!.id);

export const ARowMapsToABundle: Story = {
  // The CS maps drafts — and reads the team's bundles (the-creator-or-an-admin-edits-a-bundle).
  beforeEach: () => {
    asTeam(SELLER.id)();
    asRole(Role.SELLING_CS)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await userEvent.click(canvas.getByTestId("draft-row-mode-2-bundle"));
    await userEvent.click(within(canvas.getByTestId("draft-row-2")).getByRole("combobox"));

    const option = await screen.findByTestId(`bundle-option-${HEMAT.id}`, {}, { timeout: 4000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("draft-row-bundle-2")).toHaveTextContent(HEMAT.name));
    await expect(canvas.getByTestId("draft-row-2")).toHaveAttribute("data-mode", "bundle");
    // A bundle row is no longer a reason Promote refuses: Promote sends what is on screen, so the bundle's products
    // go on the order (a-draft-becomes-an-order-through-order-create). Only saving it on the draft still cannot keep it.
    await expect(canvas.queryByTestId("draft-gaps")?.textContent ?? "").not.toContain("cannot be promoted yet");
  },
};

/** A ROW SPLIT INTO PRODUCTS — allowed, and the screen suggests making it a bundle. */
export const ARowSplitsAndSuggestsABundle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await userEvent.click(canvas.getByTestId("draft-row-mode-0-split"));

    // It starts from the product already mapped, so switching threw nothing away.
    await waitFor(() => expect(canvas.getByTestId("draft-row-0-part-0")).toBeInTheDocument());
    await expect(canvas.getByTestId("draft-row-0-make-bundle")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("draft-row-0-add-part"));
    await expect(canvas.getByTestId("draft-row-0-part-1")).toBeInTheDocument();
  },
};

/**
 * THE LISTING'S QUANTITY AND PRICE ARE INFORMATION; the count is set on the mapping, and one that differs
 * from the listing is FLAGGED, not refused (owner: *"jumlah pun cuma info, tapi bisa jadi indicator
 * warning jika jumlahnya tidak sesuai"*).
 */
export const ACountThatDiffersFromTheListingIsFlagged: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await expect(canvas.getByTestId("draft-row-listing-0")).toHaveTextContent("2 × Rp 55.000");
    await expect(canvas.queryByTestId("draft-row-count-differs-0")).toBeNull();

    await userEvent.click(canvas.getByTestId("draft-row-count-0-minus"));
    await waitFor(() => expect(canvas.getByTestId("draft-row-count-differs-0")).toHaveTextContent("1"));
    // …and it says the draft cannot keep both numbers.
    await expect(
      within(canvas.getByTestId("draft-row-count-differs-0")).getByTestId("not-implemented-listingQty"),
    ).toBeInTheDocument();
  },
};

/**
 * THE SELL PRICE IS THE DRAFT'S OWN ONCE STORED (platform-total-is-required-at-finalize): 202 holds 130.000, so it
 * opens with it, Save has nothing to keep and Promote names no missing sell price. Typing over it is a change like any
 * other — Save turns on. Promote does not wait for it: it sends the typed figure.
 */
export const TheSellPriceIsStoredOnTheDraft: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);
    const sell = canvas.getByTestId("draft-sell-price");

    await waitFor(() => expect(sell).toHaveValue("130.000"));
    await expect(canvas.getByTestId("draft-save")).toBeDisabled();
    await expect(canvas.queryByText("The sell price is missing.")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-sellPrice")).toBeNull();

    await userEvent.clear(sell);
    await userEvent.type(sell, "128000", { delay: 20 });
    await waitFor(() => expect(canvas.getByTestId("draft-save")).toBeEnabled());
    await expect(canvas.queryByText("Save the changes first")).toBeNull();
    await expect(canvas.queryByText("The sell price is missing.")).toBeNull();
  },
};

/**
 * EACH LINE AT ITS PRODUCT'S OWN MARKUP (the-cross-markup-belongs-to-the-product): 202 borrows two of Gudang Pusat's
 * products — Kopi at 10%, Teh at none — so the one owner's row is 18.500 × 1,1 + 27.000 = 47.350. Two rates have no
 * single percentage that is true of the row, so the markup is said in rupiah.
 */
export const TheInvoiceChargesEachProductsOwnRate: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    const row = await canvas.findByTestId("invoice-row-product-11");
    await waitFor(() => expect(row).toHaveTextContent("Rp 47.350"));
    await expect(row).toHaveTextContent("Rp 45.500 at cost · Rp 1.850 markup, at each product's own rate");
  },
};

/**
 * SAVE TAKES ANY STATE; PROMOTE SENDS WHAT IS ON SCREEN (a-draft-becomes-an-order-through-order-create). Promote is
 * OrderCreate with the draft's id, so an unsaved edit is promoted as it stands — nothing has to be saved first.
 */
export const AnUnsavedEditIsPromotedAsIs: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await mapEveryBorrowedProduct(canvas);
    await waitFor(() => expect(canvas.getByTestId("draft-promote")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("draft-row-count-0-plus"));

    await waitFor(() => expect(canvas.getByTestId("draft-save")).toBeEnabled());
    await expect(canvas.getByTestId("draft-promote")).toBeEnabled();
    await expect(canvas.queryByText("Save the changes first")).toBeNull();
  },
};

/**
 * A `manual` DRAFT'S EXTERNAL ID IS NO REF — the old create form minted it (`form-…`), so the receipt card opens empty,
 * and Promote names the missing ref until it is typed (an-order-ref-is-required-by-the-rpc).
 */
export const AManualDraftAsksForItsRef: Story = {
  render: () => {
    const AtManual = Routed("/order-drafts/203");
    return <AtManual />;
  },
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);
    const ref = canvas.getByTestId("order-external-ref-id");

    await expect(ref).toHaveValue("");
    await waitFor(() =>
      expect(canvas.getByTestId("draft-gaps")).toHaveTextContent("The marketplace order number is missing."),
    );

    await userEvent.click(ref);
    await userEvent.paste("260101CCCC0003");
    await waitFor(() =>
      expect(canvas.getByTestId("draft-gaps")).not.toHaveTextContent("The marketplace order number is missing."),
    );
  },
};

/**
 * A ROW IS COSTED AT WHAT PROMOTE'S TAKE WOULD DRAW (an-order-is-costed-at-what-leaves-the-shelf). 202's Teh row takes
 * all 3 on the shelf — 1 from the 8.000 batch and 2 from the 9.500 one — so its quiet line names both batches, oldest
 * first, beside the 9.000 that the three come to a unit.
 */
export const ARowSpanningTwoBatchesShowsTheSplit: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("draft-row-stock-1")).toHaveTextContent("from 1 × Rp 8.000 + 2 × Rp 9.500"),
    );
    await expect(canvas.getByTestId("draft-row-stock-1")).toHaveTextContent("HPP Rp 9.000");
    // Kopi's one unit comes from one batch, and says nothing more.
    await expect(canvas.getByTestId("draft-row-stock-0")).not.toHaveTextContent("from");
  },
};

/** 202's second row asks for exactly the 3 the warehouse holds — one more and the alert appears. */
export const AShortLineIsCalledOutOnTop: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("draft-row-stock-1")).toHaveTextContent("3"));
    await expect(canvas.queryByTestId("draft-short")).toBeNull();

    await userEvent.click(canvas.getByTestId("draft-row-count-1-plus"));
    await waitFor(() => expect(canvas.getByTestId("draft-short")).toBeInTheDocument());
  },
};

export const AReadyDraftPromotesToAnOrder: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);
    const promote = canvas.getByTestId("draft-promote");

    // Its borrowed products hold Promote until each has its return map, named under the button.
    await waitFor(() => expect(canvas.getByTestId("order-create-blocked-mapping")).toBeInTheDocument());
    await expect(promote).toBeDisabled();

    await mapEveryBorrowedProduct(canvas);
    await waitFor(() => expect(promote).toBeEnabled());
    await userEvent.click(promote);

    // The form's checks may ask for a second look; placing anyway is the create form's own path.
    const placeAnyway = await screen.findByTestId("order-checks-place").catch(() => null);
    if (placeAnyway) {
      await waitFor(() => expect(placeAnyway).toBeVisible());
      await userEvent.click(placeAnyway);
    }

    await waitFor(() => expect(canvas.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// A PROMOTE THE WAREHOUSE REFUSES SAYS WHY (a-refusal-names-its-reason-and-every-line) — the order form's own alert:
// Gudang Pusat's Teh is held below its reserve, so the take refuses it, and the page names the product and what was
// wanted. The draft stays; nothing navigates.
export const ARefusedPromoteNamesItsReasonAndTheLine: Story = {
  beforeEach: withTakeRefusal(OrderTransactionRefusalReason.NOT_ALLOWED, [{ productId: 72n, wanted: 3n }]),
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);
    const promote = canvas.getByTestId("draft-promote");

    await mapEveryBorrowedProduct(canvas);
    await waitFor(() => expect(promote).toBeEnabled());
    await userEvent.click(promote);

    const placeAnyway = await screen.findByTestId("order-checks-place").catch(() => null);
    if (placeAnyway) {
      await waitFor(() => expect(placeAnyway).toBeVisible());
      await userEvent.click(placeAnyway);
    }

    const refusal = await canvas.findByTestId("draft-refusal");
    await expect(refusal).toHaveAttribute("data-reason", "notAllowed");
    await waitFor(() =>
      expect(canvas.getByTestId("draft-refusal-line-72")).toHaveTextContent("Teh Melati 100g: wants 3"),
    );
    await expect(canvas.queryByTestId("draft-error")).toBeNull();
    await expect(canvas.queryByTestId("at-order-detail")).toBeNull();
  },
};

export const DeleteConfirmsThenGoesBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await userEvent.click(canvas.getByTestId("draft-delete"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.getByTestId("at-order-drafts")).toBeInTheDocument());
  },
};

export const AnotherTeamsDraftIsNotFound: Story = {
  beforeEach: asTeam(OTHER_SELLER.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("draft-not-found")).toBeInTheDocument());
    await expect(canvas.queryByTestId("draft-detail-page")).toBeNull();
  },
};

/**
 * ⚠ EVERY DRAFT-ONLY GAP IS MARKED ON SCREEN — what a draft does not keep (on the note), a bundle or a
 * split mapping not being stored (on those two modes), and "Make It a Bundle" (on the button, which a
 * split row shows).
 */
export const EveryDraftGapIsMarkedOnScreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await userEvent.click(canvas.getByTestId("draft-row-mode-0-split"));
    await waitFor(() => expect(canvas.getByTestId("draft-row-0-make-bundle")).toBeInTheDocument());

    for (const id of ["draftKeeps", "rowBundle", "rowSplit"]) {
      await expect(canvas.queryAllByTestId(`not-implemented-${id}`).length).toBeGreaterThan(0);
    }

    // The sell price's mark is gone: the draft stores it now (platform-total-is-required-at-finalize).
    await expect(canvas.queryByTestId("not-implemented-sellPrice")).toBeNull();
  },
};

/**
 * THE DRAFT KEEPS THE BUYER'S USERNAME (the-buyers-username-is-optional) — seeded from what 201 holds, with no ⚠ on
 * the field, and an edit to it is a change Save picks up.
 *
 * 201 stores no sell price, so its field following the rows is itself a change; it is emptied back to what is stored
 * first, so the username is the only edit on the page.
 */
export const TheBuyersUsernameIsKeptByTheDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);
    const field = canvas.getByTestId("order-create-buyer-username");

    await waitFor(() => expect(field).toHaveValue("lestari.shop"));
    await expect(canvas.queryByTestId("not-implemented-buyerUsername")).not.toBeInTheDocument();

    await userEvent.clear(canvas.getByTestId("draft-sell-price"));
    await waitFor(() => expect(canvas.getByTestId("draft-save")).toBeDisabled());

    await userEvent.type(field, "_2", { delay: 40 });
    await waitFor(() => expect(canvas.getByTestId("draft-save")).toBeEnabled());
  },
};
