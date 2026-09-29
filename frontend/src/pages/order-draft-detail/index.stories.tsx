import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orderDraftItems, teams } from "../../../.storybook/fixtures";
import { OrderDraftDetailPage } from "./index";

// ONE DRAFT, WHERE SCRAPED TEXT BECOMES A REAL PRODUCT (#196) — a page, not a dialog.
//
// Built from the order form's parts (the lines table, the customer card, the pinned totals), and
// different only where the job differs: the scraped text above each mapping, a ProductSelect per
// line, a typed price, and a Promote that stays disabled until nothing is left.
//
//   | story                           | the rule it pins                                           |
//   | ------------------------------- | ---------------------------------------------------------- |
//   | Default                         | 201 — one unmapped line, Promote disabled and says why      |
//   | TheScrapedTextStaysBesideTheMap | the evidence is never replaced by the mapping               |
//   | AReadyDraftPromotesToAnOrder    | 202 — Promote runs and lands on the new order               |
//   | AnEditMustBeSavedBeforePromote  | Promote refuses unsaved work instead of saving silently     |
//   | AShortLineIsCalledOutOnTop      | one over the shelf → the alert, above both columns          |
//   | DeleteConfirmsThenGoesBack      | destructive → ConfirmDialog → back to the list              |
//   | AnotherTeamsDraftIsNotFound     | one side only                                               |

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

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/**
 * 201: three lines, the third unmapped. Promote is DISABLED and the reason sits beside it — a person
 * must never have to press it and read a rejection to learn what they could already see.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("draft-detail-page")).toBeInTheDocument());

    await expect(canvas.getByTestId("draft-line-unmapped-2")).toBeInTheDocument();
    await expect(canvas.getByTestId("draft-gaps")).toBeInTheDocument();
    await expect(canvas.getByTestId("draft-promote")).toBeDisabled();
    // Nothing changed yet, so there is nothing to save.
    await expect(canvas.getByTestId("draft-save")).toBeDisabled();
  },
};

// THE SAME DRAFT, ON A PHONE-SHAPED CANVAS (owner). What to look at: the two columns collapsing to
// one, and the six-column lines table scrolling inside its own box rather than pushing the page.
//
// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only (see OrderDetailPage.Mobile).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

/** The ready one, for looking at — every line mapped, Promote live. */
export const Ready: Story = {
  render: () => <AtReady />,
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/**
 * THE SCRAPED TEXT IS THE EVIDENCE, and it stays on screen above the mapping — mapped or not. It is
 * the only thing a wrong mapping can be checked against.
 */
export const TheScrapedTextStaysBesideTheMap: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("draft-lines-table")).toBeInTheDocument());

    const lines = orderDraftItems["201"]!;
    for (const [i, line] of lines.entries()) {
      await expect(canvas.getByTestId(`draft-line-scraped-${i}`)).toHaveTextContent(line.externalName);
    }

    // A mapped line says so; the unmapped one says it is not.
    await expect(canvas.getByTestId("draft-line-mapped-0")).toBeInTheDocument();
    await expect(canvas.queryByTestId("draft-line-mapped-2")).toBeNull();
  },
};

/** 202 has nothing left: Promote runs, and the page moves to the order that now exists. */
export const AReadyDraftPromotesToAnOrder: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const promote = await canvas.findByTestId("draft-promote");
    await waitFor(() => expect(promote).toBeEnabled());
    await expect(canvas.queryByTestId("draft-gaps")).toBeNull();

    await userEvent.click(promote);
    await waitFor(() => expect(canvas.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

/**
 * PROMOTE REFUSES AN UNSAVED EDIT rather than saving first. It destroys the draft, and a button that
 * quietly does two things is the wrong one to be surprised by — so it turns into "Save First".
 */
export const AnEditMustBeSavedBeforePromote: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const promote = await canvas.findByTestId("draft-promote");
    await waitFor(() => expect(promote).toBeEnabled());

    // Product 71 — the warehouse holds 40, so one more stays well within stock.
    await userEvent.click(canvas.getByTestId("draft-line-qty-0-plus"));

    await waitFor(() => expect(promote).toBeDisabled());
    await expect(promote).toHaveTextContent("Save First");
    await expect(canvas.getByTestId("draft-save")).toBeEnabled();
  },
};

/**
 * ONE OVER THE SHELF IS CALLED OUT ABOVE BOTH COLUMNS.
 *
 * 202's second line asks for exactly the 3 the warehouse holds. One click on + makes it short, and
 * the alert appears full-width — on a long draft the failing row can be off screen, and "Promote is
 * disabled and I cannot see why" is the state this page must never be in.
 */
export const AShortLineIsCalledOutOnTop: Story = {
  render: () => <AtReady />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("draft-line-stock-1")).toHaveTextContent("3"));
    await expect(canvas.queryByTestId("draft-short")).toBeNull();

    await userEvent.click(canvas.getByTestId("draft-line-qty-1-plus"));

    await waitFor(() => expect(canvas.getByTestId("draft-short")).toBeInTheDocument());
    await expect(canvas.getByTestId("draft-gaps")).toHaveTextContent("Stock");
  },
};

export const DeleteConfirmsThenGoesBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("draft-delete"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.getByTestId("at-order-drafts")).toBeInTheDocument());
  },
};

/**
 * A DRAFT ANOTHER TEAM TYPED IS "NOT FOUND". 201 is Melati's; Kenanga asks for it and gets the
 * not-found state — never Melati's customer.
 */
export const AnotherTeamsDraftIsNotFound: Story = {
  beforeEach: asTeam(OTHER_SELLER.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("draft-not-found")).toBeInTheDocument());
    await expect(canvas.queryByTestId("draft-detail-page")).toBeNull();
  },
};
