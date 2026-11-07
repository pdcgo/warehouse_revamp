import { Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, routedPage, LocationProbe } from "../../../.storybook/pageStory";
import { orderDrafts, shops, teams, users } from "../../../.storybook/fixtures";
import { OrderDraftsPage } from "./index";

// THE DRAFTS TAB OF THE ORDERS SCREEN — its own route (#195), drawn as the seller list's Drafts tab
// (`the-draft-list-is-the-drafts-tab`): the same strip, the same row grammar, fewer columns.
//
// Two jobs, and the second is the one that gets under-built: opening a draft to finish it, and
// PRUNING. Nothing expires, so bulk delete is load-bearing rather than a convenience.
//
//   | story                           | the rule it pins                                           |
//   | ------------------------------- | ---------------------------------------------------------- |
//   | Default                         | the stage strip with Drafts active, one row per draft       |
//   | EachRowSaysWhatIsLeft           | the gaps / "Ready" — not a bare yes/no; Baris a plain count  |
//   | NoDateOrNoPriceIsNotReady       | Promote refuses both, so the list never calls either ready   |
//   | NoAddressOrNoCourierIsNotReady  | the address line and the courier are gaps too                |
//   | TheListCountsNoMapping          | no "unmapped" count and no Unmapped lines gap — ever         |
//   | TheSummaryCountsWhatItCan       | total and oldest are real; ready is this page, and marked    |
//   | WhatIsLeftSitsUnderTheReference | first gap named, the rest counted, all on the title          |
//   | TheRowIsRealFieldsOnly          | shop and author are the draft's own — no invented cell       |
//   |                                 | "oleh <name> via <app>" on one line; a `manual` draft no app |
//   | AWarehouseHasNoDrafts           | a draft has ONE side — the team that typed it                |
//   | TheRowOpensTheDraft             | the whole row is the way in                                  |
//   | CopyingTheReferenceStaysHere    | the reference copies, and does not open the draft            |
//   | AStageTabGoesBackToTheList      | the strip is shared — a stage tab returns to /orders        |
//   | OneDraftDeletesFromItsMenu      | the kebab's delete confirms, like the bulk one               |
//   | BulkDeleteConfirmsFirst         | destructive → ConfirmDialog, and the toast counts            |

const SELLER = teams[1]!; // Toko Melati (12) — the only team with drafts
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

// A draft stores no mapping (a-draft-stores-no-mapping), so the list counts none (the-drafts-list-counts-no-mapping):
// what keeps a draft from Ready is a field it lacks, never a line.
const OPEN = orderDrafts.find((d) => d.id === 201n)!; // no order date, no sell price
const READY = orderDrafts.find((d) => d.id === 202n)!;
// Each one field short of READY — the two Promote refusals a summary row can read.
const NO_DATE = orderDrafts.find((d) => d.id === 203n)!; // a `manual` draft: its ref too
const NO_PRICE = orderDrafts.find((d) => d.id === 204n)!;

// Draft 202 with one more field taken away, for the story that needs it — restored after.
function draft202Without(change: (d: typeof READY) => void) {
  return () => {
    const was = { shipmentChannelId: READY.shipmentChannelId, address: READY.address };
    change(READY);

    return () => {
      READY.shipmentChannelId = was.shipmentChannelId;
      READY.address = was.address;
    };
  };
}

const Routed = routedPage(
  [
    { path: "/order-drafts", element: <OrderDraftsPage /> },
    // A draft opens IN THE ORDER FORM (the-draft-opens-in-the-order-form) — the probe shows which one it was asked for.
    {
      path: "/orders/new",
      element: (
        <>
          <Text data-testid="at-order-form">order form</Text>
          <LocationProbe />
        </>
      ),
    },
  ],
  "/order-drafts",
);

const meta = {
  // Its own story file, in the Order group (owner: *"storynya bagian dari order, tidak masalah"*).
  title: "Pages/Order/OrderDraftsPage",
  component: OrderDraftsPage,
  parameters: {
    signedIn: true,
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(SELLER.id),
  render: () => <Routed />,
} satisfies Meta<typeof OrderDraftsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`draft-row-${OPEN.id}`)).toBeInTheDocument());
    await expect(canvas.getByTestId(`draft-row-${READY.id}`)).toBeInTheDocument();
  },
};

// THE SAME LIST, ON A PHONE-SHAPED CANVAS (owner). What to look at: the tab strip at a width that
// cannot hold it, and the "Still needed" badges wrapping in their cell.
//
// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only (see OrderDetailPage.Mobile).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/**
 * WHAT IS LEFT TO DO, SPELLED OUT — not reduced to ready / not-ready.
 *
 * Somebody scanning forty drafts is choosing which to open next, and "no sell price" is a different amount of work
 * from "needs a warehouse". A draft with nothing left says Ready. *Baris* is the line count only.
 */
export const EachRowSaysWhatIsLeft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId(`draft-gaps-${OPEN.id}`)).toHaveTextContent("Order date");
    await expect(canvas.getByTestId(`draft-ready-${READY.id}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId(`draft-ready-${OPEN.id}`)).toBeNull();
    await expect(canvas.getByTestId(`draft-lines-${OPEN.id}`)).toHaveTextContent(String(OPEN.itemCount));
    await expect(canvas.getByTestId(`draft-lines-${READY.id}`)).toHaveTextContent(String(READY.itemCount));
  },
};

/**
 * NO MAPPING ON THE LIST (the-drafts-list-counts-no-mapping): a draft stores none, so no row says "N of M unmapped" and
 * no gap says *Unmapped lines* — the lines are mapped in the order form at Create, and READY (202, whose lines no one
 * has mapped) is Ready.
 */
export const TheListCountsNoMapping: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId(`draft-ready-${READY.id}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId(/^draft-unmapped-/)).toBeNull();
    await expect(canvas.getByTestId("order-drafts-table")).not.toHaveTextContent(/unmapped/i);

    for (const d of orderDrafts.filter((x) => x.teamId === SELLER.id && x.id !== READY.id)) {
      await expect(canvas.getByTestId(`draft-gaps-${d.id}`).getAttribute("title")).not.toMatch(/unmapped/i);
    }
  },
};

/**
 * NOT READY WITHOUT AN ADDRESS OR A COURIER (the-drafts-list-counts-no-mapping: Ready = shop, warehouse, customer,
 * address, courier, and every other gap filled). Draft 202 with its courier taken away names *Courier*; with its street
 * line emptied, *Address*.
 */
export const NoAddressOrNoCourierIsNotReady: Story = {
  beforeEach: draft202Without((d) => {
    d.shipmentChannelId = 0n;
    d.address = { ...d.address, addressLine: "" };
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const gaps = await canvas.findByTestId(`draft-gaps-${READY.id}`);
    await expect(gaps).toHaveTextContent("Address +1");
    await expect(gaps).toHaveAttribute("title", "Address · Courier");
    await expect(canvas.queryByTestId(`draft-ready-${READY.id}`)).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("draft-summary-ready-value")).toHaveTextContent(`0 of ${orderDrafts.length}`));
  },
};

/**
 * NOT READY WITHOUT THE ORDER DATE OR THE SELL PRICE — Promote refuses both
 * (platform-created-at-is-required-at-finalize, platform-total-is-required-at-finalize), so a list that called either
 * draft Ready would send somebody to a button that turns them away. 204 is an app's draft, one field
 * short. 203 is a `manual` one, so its ref is still to be typed too — its second gap
 * (an-order-ref-is-required-by-the-rpc).
 */
export const NoDateOrNoPriceIsNotReady: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const noDate = await canvas.findByTestId(`draft-gaps-${NO_DATE.id}`);
    await expect(noDate).toHaveTextContent("Order date");
    await expect(noDate).toHaveAttribute("title", "Order date · Marketplace order number");
    await expect(canvas.queryByTestId(`draft-ready-${NO_DATE.id}`)).toBeNull();

    const noPrice = canvas.getByTestId(`draft-gaps-${NO_PRICE.id}`);
    await expect(noPrice).toHaveTextContent("Sell price");
    await expect(noPrice).not.toHaveTextContent("+");
    await expect(canvas.queryByTestId(`draft-ready-${NO_PRICE.id}`)).toBeNull();
  },
};

/**
 * A DRAFT HAS ONE SIDE — unlike an order, which a warehouse reads from the shipping end.
 *
 * Both of Melati's drafts name Gudang Pusat as their warehouse, and Gudang Pusat still sees none:
 * a draft is not work for the building until it is promoted. ⚠ Widening this to the two-sided order
 * scope is the change this story exists to catch.
 */
export const AWarehouseHasNoDrafts: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-drafts-empty")).toBeInTheDocument());
    await expect(canvas.queryByTestId(`draft-row-${OPEN.id}`)).toBeNull();
  },
};

/**
 * THREE NUMBERS, all of the whole set. The total is the server's page count, the oldest is one ASC row off the same
 * RPC (201 was written first), and "ready" is OrderDraftList's `ready_count` (#16) — no ⚠ and no "on this page" left.
 */
export const TheSummaryCountsWhatItCan: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("draft-summary-total-value")).toHaveTextContent(String(orderDrafts.length)),
    );
    await waitFor(() => expect(canvas.getByTestId("draft-summary-oldest-value")).toHaveTextContent("2 days"));

    const ready = canvas.getByTestId("draft-summary-ready");
    // Only 202 is ready — 203 and 204 are each one Promote refusal short.
    await expect(within(ready).getByTestId("draft-summary-ready-value")).toHaveTextContent(
      `1 of ${orderDrafts.length}`,
    );
    await expect(within(ready).queryByTestId("not-implemented-readyCount")).toBeNull();
    await expect(ready).not.toHaveTextContent("on this page");
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
  },
};

/**
 * WHAT IS LEFT SITS UNDER THE REFERENCE — where the order list puts the stage. The first gap is named
 * and the rest counted, so the cell stays two lines; every gap is on the badge's title. 201 is short of two,
 * named in the order draftGaps lists them.
 */
export const WhatIsLeftSitsUnderTheReference: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId(`draft-row-${OPEN.id}`);

    const gaps = within(row).getByTestId(`draft-gaps-${OPEN.id}`);
    await expect(gaps).toHaveTextContent("Order date +1");
    await expect(gaps).toHaveAttribute("title", "Order date · Sell price");
    await expect(within(row).getByTestId("order-ref")).toHaveTextContent(OPEN.externalId);
  },
};

/**
 * EVERY CELL IS THE DRAFT'S OWN FIELD — the shop it was pushed for, the person who wrote it. The order
 * list's mocked creator has no place here, and so neither does a ⚠ on the row.
 */
export const TheRowIsRealFieldsOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId(`draft-row-${OPEN.id}`);
    const shop = shops.find((item) => item.id === OPEN.shopId)!;
    const author = users.find((item) => item.id === OPEN.authorUserId)!;

    await waitFor(() => expect(row).toHaveTextContent(shop.name));
    await waitFor(() =>
      expect(within(row).getByTestId("order-placed-by")).toHaveTextContent(author.name),
    );
    await expect(within(row).queryAllByTestId(/^not-implemented-/)).toHaveLength(0);

    // the-draft-row-names-the-person-and-the-app: the person and the app share ONE line, whole on hover.
    const by = within(row).getByTestId("order-placed-by");
    await expect(by).toHaveTextContent(`${author.name} via ${OPEN.source}`);
    await expect(by).toHaveAttribute("title", by.textContent ?? "");

    // a-table-date-is-short-and-every-time-is-wib: a cell's date is "29 Okt 13:05" — the year only when it is not this
    // year, and a colon clock — never the full "29 Okt 2026, 13.05".
    await expect(within(row).getByTestId("order-placed-at").textContent).toMatch(/^\d{1,2} \S+( \d{4})? \d{2}:\d{2}$/);

    // A `manual` draft was typed in the form, not pushed by an app — so it names no app.
    const manual = await canvas.findByTestId(`draft-row-${NO_DATE.id}`);
    await expect(NO_DATE.source).toBe("manual");
    await expect(within(manual).getByTestId("order-placed-by")).not.toHaveTextContent("via");
  },
};

export const TheRowOpensTheDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId(`draft-updated-${OPEN.id}`));
    await waitFor(() => expect(canvas.getByTestId("at-order-form")).toBeInTheDocument());
    await expect(canvas.getByTestId("location-search")).toHaveTextContent(`?draft=${OPEN.id}`);
  },
};

/** The reference is carried to the marketplace's dashboard — copying it must not also leave. */
export const CopyingTheReferenceStaysHere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId(`draft-row-${OPEN.id}`);

    await userEvent.click(within(row).getByTestId("order-ref"));
    await expect(canvas.queryByTestId("at-order-form")).toBeNull();
  },
};

/**
 * A LIST OF ITS OWN (the-drafts-are-a-list-of-their-own) — its own title with the subtitle under it, and none of the
 * order list's furniture: no stage strip, no New Order. The way in is the menu, Pesanan ▸ Draf.
 */
export const ItsOwnList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("order-drafts-heading")).toHaveTextContent("Order Drafts");
    await expect(canvas.getByTestId("order-drafts-subtitle")).toHaveTextContent("Open one to finish it in the order form");
    await waitFor(() => expect(canvas.getByTestId(`draft-row-${OPEN.id}`)).toBeInTheDocument());
    await expect(canvas.queryByTestId("orders-tab-all")).toBeNull();
    await expect(canvas.queryByTestId("orders-tab-drafts")).toBeNull();
    await expect(canvas.queryByTestId("open-create-order")).toBeNull();
  },
};

/** One draft, from its own menu — destructive, so it confirms, and names the reference it removes. */
export const OneDraftDeletesFromItsMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId(`draft-actions-${READY.id}`));

    const item = await screen.findByTestId(`draft-delete-${READY.id}`);
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByRole("alertdialog")).toHaveTextContent(READY.externalId);
    await userEvent.click(confirm);

    await expect(await screen.findByText("1 draft(s) deleted")).toBeInTheDocument();
  },
};

/**
 * BULK DELETE CONFIRMS FIRST, and says how many.
 *
 * Select-all ticks this PAGE, the button carries the count, and nothing is deleted until the dialog
 * is confirmed. The toast repeats the server's `deleted`, which can be smaller than what was asked.
 */
export const BulkDeleteConfirmsFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`draft-row-${READY.id}`)).toBeInTheDocument());
    await expect(canvas.queryByTestId("delete-selected-drafts")).toBeNull();

    await userEvent.click(within(canvas.getByTestId("select-all-drafts")).getByRole("checkbox", { hidden: true }));

    const button = await canvas.findByTestId("delete-selected-drafts");
    await expect(button).toHaveTextContent(String(orderDrafts.length));

    await userEvent.click(button);

    // The dialog portals out of the canvas.
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await expect(
      await screen.findByText(`${orderDrafts.length} draft(s) deleted`),
    ).toBeInTheDocument();
  },
};
