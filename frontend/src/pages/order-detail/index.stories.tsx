import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orderDetailFor, orders, teams, users } from "../../../.storybook/fixtures";
import { OrderDetailPage } from "./index";

// ONE ORDER, READ SECTION BY SECTION — the detail route behind every row of the order list.
//
// ⚠ THE DETAIL READ IS A DIFFERENT MESSAGE FROM A LIST ROW. `OrderDetail` is the only RPC that
// populates `items` and `events` (order.proto), and those two tables ARE the page's two tabs. So
// this screen cannot be reviewed from the list's fixtures — it needs the detail stub, which is why
// `orderDetailFor` exists beside `orders` rather than inside it.
//
// THE PAGE IS READ FROM BOTH ENDS, exactly as the list is (#151): `team_id` is the team you hold a
// role in, and the server matches it against the order's SELLING team or its WAREHOUSE. A picking
// crew opens orders it did not place, every day. `WarehouseReadsAnotherTeamsOrder` pins that, and it
// is the assertion that would fail if the scope were ever tightened to an owner check.
//
// What the stories below are for:
//
//   | story                             | the rule it pins                                        |
//   | --------------------------------- | ------------------------------------------------------- |
//   | Default                           | header, tabs, lines, money — the whole Info tab          |
//   | MarketplaceTotalDiffersFromOurs   | two totals, two facts — settlement's whole premise       |
//   | Timeline                          | the history tab, with the people resolved                |
//   | UnrecordedActor                   | actor 0 shows the STEP and stays silent about who        |
//   | CancelledOrderHasNoCancelButton   | a terminal order cannot be cancelled again               |
//   | WarehouseReadsAnotherTeamsOrder   | the two-sided scope                                      |
//   | NotFound                          | an id this team may not read                             |

const SELLER = teams[1]!; // Toko Melati (12)
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

// 101 is the order written out in full — three lines, an address, a note, a receipt, and a
// marketplace total that DISAGREES with ours.
const FULL = orderDetailFor(101n)!;
// 107 is the only CANCELLED one, and it is Melati's.
const CANCELLED = orders.find((o) => o.id === 107n)!;
// 110 belongs to Toko Kenanga but ships from Gudang Pusat — the other half of the two-sided read.
const OTHER_TEAMS = orders.find((o) => o.id === 110n)!;

const Routed = (path: string) =>
  routedPage(
    [
      { path: "/orders/:orderId", element: <OrderDetailPage /> },
      marker("/orders", "at-order-list"),
    ],
    path,
  );

const AtFullOrder = Routed(`/orders/${FULL.id}`);

const meta = {
  title: "Pages/Order/OrderDetailPage",
  component: OrderDetailPage,
  parameters: {
    // `useTeam()` throws outside a TeamProvider, and this page reads the current team on every path.
    signedIn: true,
    // The page builds its own data router (pageStory.tsx), so the shared one stands down.
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(SELLER.id),
  render: () => <AtFullOrder />,
} satisfies Meta<typeof OrderDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());

    // The header is the ORDER's, and stays put whichever tab is open.
    await expect(canvas.getByTestId("order-detail-title")).toHaveTextContent(FULL.id.toString());
    await expect(canvas.getByTestId("order-detail-tabs")).toBeInTheDocument();

    // Info opens first — it is what the order IS, and it is where the lines live.
    for (const line of FULL.items) {
      await expect(canvas.getByText(line.name)).toBeInTheDocument();
    }
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/**
 * TWO TOTALS, TWO FACTS — and they disagree on purpose.
 *
 * `total` is what WE quoted; `marketplace_total` is what the BUYER PAID THE PLATFORM. Settlement
 * opens every order's account from the marketplace figure and never from ours, so a fixture where
 * the two matched would make every downstream screen look correct by accident.
 *
 * ⚠ This is the number the settlement design is built on — see
 * `pages/order-settlement/components/OrderDetailPreview.tsx`, which asserts the same figure reaches
 * the settlement tab unchanged.
 */
export const MarketplaceTotalDiffersFromOurs: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByTestId("order-detail-title")).toBeInTheDocument(),
    );

    await expect(FULL.marketplaceTotal).not.toBe(FULL.total);
    await expect(canvasElement).toHaveTextContent(/Rp 250\.000/); // ours
    await expect(canvasElement).toHaveTextContent(/Rp 245\.000/); // the platform's
  },
};

/**
 * THE HISTORY TAB, WITH THE PEOPLE RESOLVED.
 *
 * The actor ids come from the EVENTS — the order row records no actor at all — and are resolved
 * through a separate `UserByIDs` read. ⚠ `fetchActors` SWALLOWS a failure there, so an unstubbed
 * lookup does not throw: it quietly degrades every step to "User #61". This story is what notices.
 */
export const Timeline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await userEvent.click(canvas.getByTestId("order-detail-tab-timeline"));

    const ani = users.find((u) => u.id === 61n)!;
    await waitFor(async () => {
      await expect(canvasElement).toHaveTextContent(ani.name);
    });
  },
};

/**
 * ACTOR 0 IS "NOT RECORDED", NOT "USER ZERO".
 *
 * Every event backfilled by the history migration is in that state. The step must still SHOW — it
 * happened — while the page stays silent about who took it. Inventing a name there would be worse
 * than the gap, and hiding the step would be worse still.
 */
const AtBackfilled = Routed("/orders/108");

export const UnrecordedActor: Story = {
  render: () => <AtBackfilled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await userEvent.click(canvas.getByTestId("order-detail-tab-timeline"));

    // The steps are there — asserted by TESTID, not by the word "shipped", which also appears in the
    // status badge in the header and would pass against a completely empty timeline.
    await waitFor(() => expect(canvas.getByTestId("order-timeline-shipped")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-timeline-placed")).toBeInTheDocument();

    // …and nobody is named on them. Both halves are checked: no resolved person block, and no
    // "User #0" — the fallback firing on an id that means ABSENCE is the specific bug here.
    await expect(canvas.queryByTestId("order-timeline-shipped-by")).not.toBeInTheDocument();
    await expect(canvasElement).not.toHaveTextContent(/User #0/);
  },
};

/**
 * A CANCELLED ORDER CANNOT BE CANCELLED AGAIN.
 *
 * Cancel is offered only while the goods are still in the building (PLACED or CONFIRMED). On a
 * terminal order the button is ABSENT rather than disabled — there is no action left to explain.
 */
const AtCancelled = Routed(`/orders/${CANCELLED.id}`);

export const CancelledOrderHasNoCancelButton: Story = {
  render: () => <AtCancelled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await expect(canvas.queryByTestId("order-cancel")).not.toBeInTheDocument();
  },
};

/**
 * THE SCOPE IS TWO-SIDED — a warehouse reads an order it did not place.
 *
 * 110 belongs to Toko Kenanga and ships from Gudang Pusat. The picking crew must be able to open the
 * job they are picking, so `team_id` matching the WAREHOUSE is enough. ⚠ Tightening this to an owner
 * check is the change this story exists to catch.
 */
const AtOtherTeamsOrder = Routed(`/orders/${OTHER_TEAMS.id}`);
// 107 is CANCELLED and has no settlement account in the stub — the "never settled" case.
const AtCancelledOrder = Routed(`/orders/${CANCELLED.id}`);

export const WarehouseReadsAnotherTeamsOrder: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <AtOtherTeamsOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-detail-title")).toHaveTextContent(
      OTHER_TEAMS.id.toString(),
    );
    await expect(canvas.getByText(OTHER_TEAMS.customerName)).toBeInTheDocument();
  },
};

/**
 * AN ORDER THIS TEAM MAY NOT READ IS "NOT FOUND", not "forbidden".
 *
 * 110 is Kenanga's and ships from Gudang Pusat, so Melati is on neither side of it. The page shows
 * the error and keeps the way back — a dead end with no back button is how somebody gets stuck on a
 * URL they mistyped.
 */
const AtForbidden = Routed("/orders/110");

export const NotFound: Story = {
  render: () => <AtForbidden />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-error")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-detail-back")).toBeInTheDocument();
  },
};

/**
 * A MALFORMED ID NEVER REACHES THE SERVER.
 *
 * The query is disabled for it, so the message comes from the page rather than from an error no
 * request produced — which is also why this cannot be folded into `NotFound`: one is a refusal, the
 * other never asked.
 */
const AtGarbageId = Routed("/orders/not-a-number");

export const InvalidId: Story = {
  render: () => <AtGarbageId />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-error")).toBeInTheDocument());
  },
};

/**
 * THE SETTLEMENT LEDGER IN ITS REAL SEAT — the third tab.
 *
 * `order-detail-manages-the-ledger` put it here rather than on a screen of its own: the ledger is a
 * property OF an order, and the person adding a row is looking at that order.
 *
 * This pins the tab against the settlement design's own WORKED example, so the numbers on screen are
 * the ones the design was reviewed with — the buyer paid 120.000, part of it never arrived, and the
 * gap is the platform's take rather than a debt anybody will collect.
 */
export const SettlementLedger: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await userEvent.click(canvas.getByTestId("order-detail-tab-settlement"));

    // The panel loads from the real query hook through the stubbed transport — not a prop — so this
    // also proves the adapter maps the wire enums back to the shapes the panel was designed against.
    await waitFor(() => {
      expect(canvas.queryByTestId("settlement-absent")).not.toBeInTheDocument();
    });

    await waitFor(async () => {
      await expect(canvasElement).toHaveTextContent("120.000");
    });
  },
};

/**
 * ⚠ NEVER SETTLED IS NOT SETTLED TO ZERO.
 *
 * The service answers NotFound for an order with no account, and the tab must SAY so. A zeroed panel
 * would read as a completed settlement nobody performed — the one reading that is worse than showing
 * nothing, because it looks like an answer.
 */
export const SettlementNotRecordedYet: Story = {
  render: () => <AtCancelledOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await userEvent.click(canvas.getByTestId("order-detail-tab-settlement"));

    await waitFor(() => {
      expect(canvas.getByTestId("settlement-absent")).toBeInTheDocument();
    });
  },
};
