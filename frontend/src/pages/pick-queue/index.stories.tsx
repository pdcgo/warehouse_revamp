import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { returnAcceptScenario, withOrderStatus, withOrdersInReturn } from "../../../.storybook/sessionScenario";
import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orders, teams } from "../../../.storybook/fixtures";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { PickQueuePage } from "./index";

// THE WAREHOUSE'S ORDERS (#151) — /warehouse-orders, the crew's queue, one tab per step of its day.
//
// Its own route rather than a team-type branch of /orders: the selling list has shops, money and a
// New Order button a warehouse has none of. The scope is the BUILDING — every order shipping from
// here, whoever sold it.
//
//   | story                              | the rule it pins                                         |
//   | ---------------------------------- | -------------------------------------------------------- |
//   | Default                            | opens on NEW — a just-placed order is the top of the day  |
//   | AnotherSellersOrderIsInTheQueue    | the scope is the building, not the seller                 |
//   | EachTabIsOneStep                   | To Pick = CONFIRMED only                                  |
//   | AnEmptyStepNamesTheStep            | "No new orders", not "no orders"                          |
//   | ASellingTeamIsTurnedAway           | a seller has no shelves — says so, no empty table         |
//   | ARowOpensThePickList               | the row's way in                                          |
//   | TheReturnsTabListsWhatIsComingBack | the claimed returns — the accept's queue                  |
//   | TheReturnWarehouseListsReturnsIt…  | the configured return warehouse lists its team's returns  |
//   | AnotherWarehousesLiveOrderIsNot…   | …and only while they are returns                          |
//   | ReceiveFindsAnOrderAlreadyInReturn | Receive a Return: a scanned tracking number → Accept Return |
//   | ReceiveForcesAShippedOrderThenAcc… | shipped → Force Return, confirmed → straight on to accept  |
//   | ReceiveNotFound                    | an unknown number, or another warehouse's parcel: not found |
//   | ReceiveAnOrderThatCannotBeReturned | pending: a sentence why, no button                         |
//   | Phone                              | the action is an icon in the one-row header; full screen   |

const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const OTHER_WAREHOUSE = teams[3]!; // Gudang Cabang (14)
const SELLER = teams[1]!; // Toko Melati (12)

const HERE = orders.filter((o) => o.warehouseId === WAREHOUSE.id);
const NEW_HERE = HERE.filter((o) => o.status === OrderStatus.PENDING); // 101, 102, 110
// Kenanga's — a seller whose own list Melati never sees, shipping from this floor.
const KENANGAS = HERE.find((o) => o.teamId === teams[2]!.id && o.status === OrderStatus.PENDING)!; // 110
// Melati's, but shipping from Gudang Cabang: somebody else's job.
const SHIPS_ELSEWHERE = orders.find((o) => o.warehouseId === OTHER_WAREHOUSE.id)!; // 107

const Routed = routedPage(
  [
    { path: "/warehouse-orders", element: <PickQueuePage /> },
    marker("/warehouse-orders/:orderId", "at-pick-order"),
  ],
  "/warehouse-orders",
);

const meta = {
  title: "Pages/Order/PickQueuePage",
  component: PickQueuePage,
  parameters: {
    signedIn: true,
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <Routed />,
} satisfies Meta<typeof PickQueuePage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/**
 * OPENS ON NEW, and the just-placed orders are in it. ⚠ This screen used to open on To Pick while
 * every fresh order sat at PLACED, so a warehouse that had just been sent work found an empty screen.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId(`pick-queue-row-${NEW_HERE[0]!.id}`)).toBeInTheDocument(),
    );

    for (const o of NEW_HERE) {
      await expect(canvas.getByTestId(`pick-queue-row-${o.id}`)).toBeInTheDocument();
    }
  },
};

// THE QUEUE ON A PHONE-SHAPED CANVAS (owner) — the crew reads it with a scanner in the other hand.
// What to look at: six tabs at a width that holds three.
//
// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only (see OrderDetailPage.Mobile).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/**
 * THE SCOPE IS THE BUILDING. Kenanga's order ships from here, so it is here; Melati's 107 ships from
 * Gudang Cabang, so it is not — even on the All tab.
 */
export const AnotherSellersOrderIsInTheQueue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("pick-tab-all"));

    await waitFor(() => expect(canvas.getByTestId(`pick-queue-row-${KENANGAS.id}`)).toBeInTheDocument());
    await expect(canvas.queryByTestId(`pick-queue-row-${SHIPS_ELSEWHERE.id}`)).toBeNull();
  },
};

/** Each tab is ONE step — To Pick is CONFIRMED and nothing else, so a PLACED order leaves it. */
export const EachTabIsOneStep: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const confirmed = HERE.find((o) => o.status === OrderStatus.PROCESSED)!; // 103

    await waitFor(() => expect(canvas.getByTestId(`pick-queue-row-${NEW_HERE[0]!.id}`)).toBeInTheDocument());
    await userEvent.click(canvas.getByTestId("pick-tab-topick"));

    await waitFor(() => expect(canvas.getByTestId(`pick-queue-row-${confirmed.id}`)).toBeInTheDocument());
    await expect(canvas.queryByTestId(`pick-queue-row-${NEW_HERE[0]!.id}`)).toBeNull();
  },
};

/**
 * AN EMPTY STEP NAMES THE STEP. Gudang Cabang's two orders are CONFIRMED and CANCELLED, so its New
 * tab is empty — and says "no new orders", not "no orders", which would read as a building that has
 * never shipped anything.
 */
export const AnEmptyStepNamesTheStep: Story = {
  beforeEach: asTeam(OTHER_WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const empty = await canvas.findByTestId("pick-queue-empty");
    await expect(empty).toHaveTextContent(/new/i);
  },
};

/**
 * A SELLING TEAM IS TURNED AWAY IN WORDS. It has orders but no shelves, and an empty table here would
 * read as a quiet day rather than as the wrong screen.
 */
export const ASellingTeamIsTurnedAway: Story = {
  beforeEach: asTeam(SELLER.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-queue-not-warehouse")).toBeInTheDocument());
    await expect(canvas.queryByTestId("pick-queue-table")).toBeNull();
  },
};

export const ARowOpensThePickList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId(`pick-queue-row-${KENANGAS.id}`));
    await waitFor(() => expect(canvas.getByTestId("at-pick-order")).toBeInTheDocument());
  },
};

/**
 * THE RETURNS TAB IS THE ACCEPT'S QUEUE (the-accept-is-the-status-return-completed) — the orders claimed back and not yet
 * in the crew's hands. Order 110, read in `return`, is listed there; a pending order is not.
 */
export const TheReturnsTabListsWhatIsComingBack: Story = {
  beforeEach: withOrdersInReturn(110n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("pick-tab-return"));

    await waitFor(() => expect(canvas.getByTestId("pick-queue-row-110")).toBeInTheDocument());
    await expect(canvas.queryByTestId("pick-queue-row-101")).toBeNull();
  },
};

/**
 * THE CONFIGURED RETURN WAREHOUSE SEES WHAT IS COMING BACK TO IT (a-return-may-land-in-another-warehouse). Order 109 is
 * Toko Melati's and ships from Gudang Cabang — but Melati returns to Gudang Pusat, so once it is a return it is on Gudang
 * Pusat's Returns tab, beside its own. Before it is a return it is none of Gudang Pusat's business.
 */
export const TheReturnWarehouseListsReturnsItDidNotShip: Story = {
  beforeEach: withOrdersInReturn(109n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("pick-tab-return"));
    await waitFor(() => expect(canvas.getByTestId("pick-queue-row-109")).toBeInTheDocument());

    await userEvent.click(canvas.getByTestId("pick-tab-all"));
    await waitFor(() => expect(canvas.getByTestId("pick-queue-row-109")).toBeInTheDocument());
  },
};

/** …and not before: the same order, still processed at Gudang Cabang, is on none of Gudang Pusat's tabs. */
export const AnotherWarehousesLiveOrderIsNotListed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("pick-tab-all"));
    await waitFor(() => expect(canvas.getByTestId("pick-queue-table")).toBeInTheDocument());
    await expect(canvas.queryByTestId("pick-queue-row-109")).toBeNull();
  },
};

// ── Receive a Return (a-return-is-received-by-search-then-forced, B) ───────────────────────────────────────────────
//
// The crew has a returned parcel in its hands: scan the label (a scanner types the code and presses Enter) or type the
// ref, and the order is found among this warehouse's — then accepted, forced first, or refused in a sentence.

const RETURNED = orders.find((o) => o.id === 110n)!; // Kenanga's, ships from here — read in `return`
const SHIPPED_HERE = orders.find((o) => o.id === 106n)!; // Melati's, handed over here — read as `shipped`
const PENDING_HERE = orders.find((o) => o.id === 101n)!; // Melati's, never left the building

const PHONE = { viewport: { value: "mobile2" } };

/** Opens Receive a Return from the header and answers its input, focused. */
async function openReceive(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await userEvent.click(await canvas.findByTestId("pick-queue-receive"));
  const input = await screen.findByTestId("receive-return-input");
  await waitFor(() => expect(input).toBeVisible());
  await waitFor(() => expect(input).toHaveFocus());

  return input;
}

/** What a handheld scanner does: types the whole code, then presses Enter. */
async function scan(input: HTMLElement, code: string) {
  await userEvent.type(input, `${code}{Enter}`, { delay: 20 });
}

/**
 * ALREADY IN RETURN — customer service claimed it first. The scanned tracking number finds it, with its shop and customer,
 * and its one step is Accept Return: the existing dialog opens on the order's lines, and the accept lands.
 */
export const ReceiveFindsAnOrderAlreadyInReturn: Story = {
  beforeEach: withOrdersInReturn(RETURNED.id),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("pick-queue-receive")).toHaveTextContent("Receive a Return");
    const input = await openReceive(canvasElement);
    await scan(input, RETURNED.receiptCode);

    const row = await screen.findByTestId("receive-return-row-110");
    await expect(row).toHaveTextContent("#110");
    await expect(row).toHaveTextContent(RETURNED.orderExternalRefId!);
    await expect(row).toHaveTextContent(RETURNED.customerName);
    await expect(row).toHaveTextContent("Return");
    await waitFor(() => expect(screen.getByTestId("receive-return-shop-110")).toHaveTextContent("Kenanga Official"));
    await expect(screen.queryByTestId("receive-return-force-110")).toBeNull();

    await userEvent.click(screen.getByTestId("receive-return-accept-110"));
    const accept = await screen.findByTestId("accept-return-dialog");
    await waitFor(() => expect(accept).toBeVisible());
    await expect(accept).toHaveTextContent("Accept Return #110");

    await userEvent.click(screen.getByTestId("accept-return-submit"));
    await expect((await screen.findAllByText("Return accepted")).length).toBeGreaterThan(0);
    await expect(returnAcceptScenario.last?.orderId).toBe(110n);

    // The search re-reads: the parcel is received, and saying so is all that is left.
    await waitFor(() => expect(screen.getByTestId("receive-return-reason-110")).toHaveTextContent("already accepted"));
  },
};

/**
 * NOT A RETURN YET — the parcel beat customer service to it. A shipped order offers Force Return, which confirms in the
 * owner's words, moves the order to `return`, and goes straight on to Accept Return.
 */
export const ReceiveForcesAShippedOrderThenAccepts: Story = {
  beforeEach: withOrderStatus(SHIPPED_HERE.id, OrderStatus.SHIPPED),
  play: async ({ canvasElement }) => {
    const input = await openReceive(canvasElement);
    await scan(input, SHIPPED_HERE.orderExternalRefId!);

    const row = await screen.findByTestId("receive-return-row-106");
    await expect(row).toHaveTextContent("Shipped");
    await expect(screen.queryByTestId("receive-return-accept-106")).toBeNull();

    await userEvent.click(screen.getByTestId("receive-return-force-106"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText('Order #106 is "Shipped". Mark it as returned so you can accept it?')).toBeInTheDocument();
    await expect(confirm).toHaveTextContent("Force Return");
    await userEvent.click(confirm);

    // Straight on to the accept — no second search, no second press.
    const accept = await screen.findByTestId("accept-return-dialog");
    await waitFor(() => expect(accept).toBeVisible());
    await expect(accept).toHaveTextContent("Accept Return #106");
    await expect(returnAcceptScenario.inReturn).toContain(106n);

    await userEvent.click(screen.getByTestId("accept-return-submit"));
    await expect((await screen.findAllByText("Return accepted")).length).toBeGreaterThan(0);
    await expect(returnAcceptScenario.last?.orderId).toBe(106n);
  },
};

/**
 * NOT FOUND, SAID PLAINLY — a number nobody has, and a real tracking number of an order that ships from Gudang Cabang:
 * neither is this warehouse's, so neither is found.
 */
export const ReceiveNotFound: Story = {
  play: async ({ canvasElement }) => {
    const input = await openReceive(canvasElement);

    await scan(input, "JX9999999999");
    const empty = await screen.findByTestId("receive-return-empty");
    await expect(empty).toHaveTextContent("No order of this warehouse matches JX9999999999.");

    // The field emptied itself after Enter, so the next scan is a search of its own.
    await scan(input, SHIPS_ELSEWHERE.receiptCode);
    await waitFor(() =>
      expect(screen.getByTestId("receive-return-empty")).toHaveTextContent(`matches ${SHIPS_ELSEWHERE.receiptCode}.`),
    );
    await expect(screen.queryByTestId(`receive-return-row-${SHIPS_ELSEWHERE.id}`)).toBeNull();
  },
};

/** A PENDING ORDER NEVER LEFT — found, and told why it cannot come back as a return: no Force, no Accept. */
export const ReceiveAnOrderThatCannotBeReturned: Story = {
  play: async ({ canvasElement }) => {
    const input = await openReceive(canvasElement);
    await scan(input, PENDING_HERE.orderExternalRefId!);

    const reason = await screen.findByTestId("receive-return-reason-101");
    await expect(reason).toHaveTextContent('Order #101 is still "Pending" — its goods never left the warehouse');
    await expect(screen.queryByTestId("receive-return-force-101")).toBeNull();
    await expect(screen.queryByTestId("receive-return-accept-101")).toBeNull();
  },
};

/**
 * ON A PHONE the header stays one row: the title, the team, and Receive a Return as its icon. The dialog takes the whole
 * screen, and a found return's Accept Return spans it — the thumb's target.
 */
export const Phone: Story = {
  globals: PHONE,
  beforeEach: withOrdersInReturn(RETURNED.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const title = await canvas.findByRole("heading", { name: "Orders" });
    const receive = await canvas.findByTestId("pick-queue-receive");
    await expect(receive).toHaveAccessibleName("Receive a Return");
    await expect(receive).not.toHaveTextContent("Receive a Return");
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    await expect(Math.abs(centre(title) - centre(receive))).toBeLessThan(8);

    const input = await openReceive(canvasElement);
    const dialog = screen.getByTestId("receive-return-dialog");
    await expect(dialog.getBoundingClientRect().width).toBeGreaterThanOrEqual(window.innerWidth - 1);

    await scan(input, RETURNED.receiptCode);
    const accept = await screen.findByTestId("receive-return-accept-110");
    await expect(accept.getBoundingClientRect().width).toBeGreaterThan(dialog.getBoundingClientRect().width * 0.7);
  },
};
