import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orderDraftItems, teams } from "../../../.storybook/fixtures";
import { BUNDLES } from "../../features/orders/form/mockData";
import { OrderDraftDetailPage } from "./index";

// THE DRAFT PAGE IN THE ORDER FORM'S CLOTHES (`the-draft-page-wears-the-order-form`) — `/order-drafts/:id`.
//
//   | story                                   | the rule it pins                                        |
//   | --------------------------------------- | ------------------------------------------------------- |
//   | Default                                 | 201 — one unmapped row: Promote refused, and says why    |
//   | TheScrapedTextStaysAboveTheMap          | the evidence is never replaced by the mapping            |
//   | TheSellPriceStartsFromTheRows           | Σ qty × MP price, typed over, reset back to the rows     |
//   | ACountThatDiffersFromTheListingIsFlagged | listing qty/price are info; a different count is flagged  |
//   | ARowMapsToABundle                       | Bundle → the template's slots, and Promote refuses it    |
//   | ARowSplitsAndSuggestsABundle            | Pecah → parts, and "Make It a Bundle" is offered         |
//   | AnEditMustBeSavedBeforePromote          | Save any state; Promote refuses unsaved work             |
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

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/** 201: three rows, the third unmapped. Promote is refused and the reasons sit under it. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await expect(canvas.getByTestId("draft-line-unmapped-2")).toBeInTheDocument();
    await expect(canvas.getByTestId("draft-gaps")).toBeInTheDocument();
    await expect(canvas.getByTestId("draft-promote")).toBeDisabled();
    await expect(canvas.getByTestId("draft-save")).toBeDisabled();
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

/** A ROW MAPPED TO A BUNDLE — the template's slots open under it, and Promote says it cannot take it. */
export const ARowMapsToABundle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await userEvent.click(canvas.getByTestId("draft-row-mode-2-bundle"));
    await userEvent.click(within(canvas.getByTestId("draft-row-2")).getByRole("combobox"));

    const option = await screen.findByTestId(`bundle-option-${BUNDLES[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("draft-row-bundle-2")).toHaveTextContent(BUNDLES[0]!.name));
    await expect(canvas.getByTestId("draft-row-2")).toHaveAttribute("data-mode", "bundle");
    await expect(canvas.getByTestId("draft-gaps")).toHaveTextContent("cannot be promoted yet");
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

/** SAVE TAKES ANY STATE; PROMOTE REFUSES UNSAVED WORK. */
export const AnEditMustBeSavedBeforePromote: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("draft-promote")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("draft-row-count-0-plus"));

    await waitFor(() => expect(canvas.getByTestId("draft-save")).toBeEnabled());
    await expect(canvas.getByTestId("draft-promote")).toBeDisabled();
    await expect(canvas.getByTestId("draft-gaps")).toHaveTextContent("Save the changes first");
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

    for (const id of ["draftKeeps", "sellPrice", "rowBundle", "rowSplit", "makeBundle"]) {
      await expect(canvas.queryAllByTestId(`not-implemented-${id}`).length).toBeGreaterThan(0);
    }
  },
};
