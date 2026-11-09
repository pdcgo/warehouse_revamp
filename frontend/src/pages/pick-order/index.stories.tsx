import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import {
  asAdminTeam,
  returnAcceptScenario,
  statusChangeScenario,
  withOrderStatus,
  withOrdersInReturn,
} from "../../../.storybook/sessionScenario";
import { orderDetailFor, orders, teams } from "../../../.storybook/fixtures";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { PickOrderPage } from "./index";

// ONE ORDER AS THE CREW READS IT (#151) — its lines, and WHICH SHELF to walk to for each.
//
// The shelf column is the whole point: it comes from StockPickLocations, the shelves this order's
// goods were actually drawn from when it was placed. Order 101 is the fixture built for it — its three
// lines land on the three things a shelf cell can say (two shelves / unplaced / nothing recorded).
//
//   | story                           | the rule it pins                                           |
//   | ------------------------------- | ---------------------------------------------------------- |
//   | Default                         | where it is going, the note, the pick list                  |
//   | EveryShelfIsListed              | two shelves = two walks — never one chosen for the picker    |
//   | UnplacedIsAPlace                | rack 0 is said in words, not left blank                     |
//   | NoRecordedDrawSaysSo            | an order from before #149 has no shelf — and says so         |
//   | TheNoteIsReadBeforeTheWalk      | every note row, newest first, on the crew's screen           |
//   | ThereIsOneNextStep              | PENDING → "Confirm Order", and it is recorded                |
//   | AShippedOrderHasNoStepLeft      | a handed-over order leaves nothing to press                  |
//   | AnOrderShippingElsewhereIsNot…  | the scope is this building                                   |
//   | ASellingTeamIsTurnedAway        | no shelves, no pick list                                     |
//   | AReturnOpensTheAcceptPage       | RETURN → Accept Return opens the accept page                 |
//   | OnlyAReturnOffersTheAccept      | a pending order is confirmed, never accepted as a return     |
//   | TheReturnWarehouseAccepts…      | the configured return warehouse opens a return's accept      |
//   | ForceReturnOnTheOrderPage       | shipped → Force Return, confirmed → Accept Return, the page   |
//   | ForceReturnIsOnlyForAParcel…    | a pending order offers no Force Return                       |
//   | SetPickedIsTheScans             | processed: the racks, then the item scans — wrong refused,   |
//   |                                 | too many refused, every line exact turns Set Picked on       |
//   | NoPlainMarkPicked               | a processed order has no plain "Mark Picked" to press        |
//   | OnlyAProcessedOrderIsScanned    | a pending or picked order shows no item scan                 |
//   | AMonitorReadsThePickPageOnly    | a monitoring team reads the racks; no scan, no step          |

const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const SELLER = teams[1]!; // Toko Melati (12)

const FULL = orderDetailFor(101n)!; // PENDING, three lines, a note from each side, an address
// Handed over — the warehouse's last step, so nothing is left to press.
const SHIPPED = orders.find((o) => o.warehouseId === WAREHOUSE.id && o.status === OrderStatus.SHIPPING)!;
const ELSEWHERE = orders.find((o) => o.warehouseId !== WAREHOUSE.id)!; // 107, Gudang Cabang's

const Routed = (path: string) =>
  routedPage(
    [
      { path: "/warehouse-orders/:orderId", element: <PickOrderPage /> },
      marker("/warehouse-orders", "at-pick-queue"),
      // The accept page (the-return-accept-page-is-accepted) — its own stories are Pages/Warehouse/OrderReturnAccept.
      marker("/warehouse-orders/:orderId/accept-return", "at-return-accept"),
    ],
    path,
  );

const AtFull = Routed(`/warehouse-orders/${FULL.id}`);
// Confirmed, being picked — the order the item scan is for (the-item-scans-live-on-the-page).
const PROCESSED = orderDetailFor(orders.find((o) => o.warehouseId === WAREHOUSE.id && o.status === OrderStatus.PROCESSED)!.id)!;
const AtProcessed = Routed(`/warehouse-orders/${PROCESSED.id}`);
const AtShipped = Routed(`/warehouse-orders/${SHIPPED.id}`);
const AtElsewhere = Routed(`/warehouse-orders/${ELSEWHERE.id}`);

const meta = {
  title: "Pages/Order/PickOrderPage",
  component: PickOrderPage,
  parameters: {
    signedIn: true,
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <AtFull />,
} satisfies Meta<typeof PickOrderPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-list-table")).toBeInTheDocument());

    for (const item of FULL.items) {
      await expect(canvas.getByTestId(`pick-line-${item.productId}`)).toHaveTextContent(item.name);
    }
    // Where it is going — the crew writes it on the parcel.
    await expect(canvasElement).toHaveTextContent(FULL.customerPhone);
  },
};

// THE PICK LIST ON A PHONE-SHAPED CANVAS (owner) — the width it is actually read at, walking an aisle.
//
// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only (see OrderDetailPage.Mobile).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** TWO SHELVES MEANS TWO WALKS, each with its own quantity — never one shelf chosen on the picker's behalf. */
export const EveryShelfIsListed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-shelf-301-41")).toBeInTheDocument());
    await expect(canvas.getByTestId("pick-shelf-301-41")).toHaveTextContent("A-01-1");
    await expect(canvas.getByTestId("pick-shelf-301-42")).toHaveTextContent("A-01-2");
  },
};

/** UNPLACED IS A PLACE (#135) — stock never shelved. A blank would read as "we do not know". */
export const UnplacedIsAPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-shelf-302-0")).toHaveTextContent("Unplaced"));
  },
};

/** NO RECORDED DRAW is said plainly — a blank cell reads as "we forgot". */
export const NoRecordedDrawSaysSo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-line-noshelf-303")).toBeInTheDocument());
  },
};

/**
 * THE NOTES ARE ON THE CREW'S SCREEN — the one person they are written for is standing here. Every note row
 * (a-note-is-a-timeline-row), newest first, and read-only: a note is added from the order's detail.
 */
export const TheNoteIsReadBeforeTheWalk: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 101's two notes, newest first: the warehouse's, then the one typed on the create form.
    const notes = FULL.timelineLogs
      .filter((log) => log.status === 0)
      .sort((a, b) => Number(b.createdAtUnix - a.createdAtUnix));

    await waitFor(() => expect(canvas.getAllByTestId("pick-order-note")).toHaveLength(notes.length));

    const shown = canvas.getAllByTestId("pick-order-note-text");
    for (const [i, note] of notes.entries()) {
      await expect(shown[i]).toHaveTextContent(note.note!);
    }

    // No way to write or change one here.
    await expect(canvas.queryByTestId("notes-input")).not.toBeInTheDocument();
  },
};

/**
 * THERE IS ONE NEXT STEP, never a set to choose from. 101 is PLACED, so the button is Confirm Order,
 * and pressing it is recorded (the toast). The stub is stateless — the badge moving is the
 * invalidation's job, not this page's.
 */
export const ThereIsOneNextStep: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const advance = await canvas.findByTestId("pick-order-advance");
    await expect(advance).toHaveTextContent("Confirm Order");

    await userEvent.click(advance);
    await expect(await screen.findByText("Order confirmed")).toBeInTheDocument();
  },
};

export const AShippedOrderHasNoStepLeft: Story = {
  render: () => <AtShipped />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-list-table")).toBeInTheDocument());
    await expect(canvas.queryByTestId("pick-order-advance")).toBeNull();
  },
};

/**
 * AN ORDER SHIPPING FROM ANOTHER BUILDING IS NOT FOUND HERE — with the way back kept, so a mistyped
 * URL is not a dead end.
 */
export const AnOrderShippingElsewhereIsNotFound: Story = {
  render: () => <AtElsewhere />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-order-error")).toBeInTheDocument());

    await userEvent.click(canvas.getByTestId("pick-order-back"));
    await waitFor(() => expect(canvas.getByTestId("at-pick-queue")).toBeInTheDocument());
  },
};

export const ASellingTeamIsTurnedAway: Story = {
  beforeEach: asTeam(SELLER.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-order-not-warehouse")).toBeInTheDocument());
    await expect(canvas.queryByTestId("pick-list-table")).toBeNull();
  },
};

// ── The return accept (the-accept-is-the-status-return-completed) ─────────────────────────────────

/**
 * A RETURN'S ONE STEP IS THE ACCEPT. Order 101 read in `return`: the crew's screen offers Accept Return and no plain move
 * — it opens the accept page (the-return-accept-page-is-accepted), where the parcel is counted and racked.
 */
export const AReturnOpensTheAcceptPage: Story = {
  beforeEach: withOrdersInReturn(FULL.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const button = await canvas.findByTestId("pick-order-accept-return");
    await expect(canvas.queryByTestId("pick-order-advance")).toBeNull();

    await userEvent.click(button);
    await waitFor(() => expect(canvas.getByTestId("at-return-accept")).toBeInTheDocument());
    // Nothing is accepted by opening it.
    await expect(returnAcceptScenario.calls).toBe(0);
  },
};

/** ONLY A RETURN OFFERS THE ACCEPT — the same order, pending, offers Confirm Order and no Accept Return. */
export const OnlyAReturnOffersTheAccept: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("pick-order-advance")).toHaveTextContent("Confirm Order");
    await expect(canvas.queryByTestId("pick-order-accept-return")).toBeNull();
  },
};

/**
 * THE RETURN WAREHOUSE ACCEPTS AN ORDER IT DID NOT SHIP (only-the-return-warehouse-accepts-a-return). Order 109 shipped
 * from Gudang Cabang; Toko Melati returns to Gudang Pusat, whose crew opens it and its Accept Return — the page.
 */
const AtReturnedElsewhere = Routed("/warehouse-orders/109");

export const TheReturnWarehouseAcceptsAnOrderItDidNotShip: Story = {
  beforeEach: withOrdersInReturn(109n),
  render: () => <AtReturnedElsewhere />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("pick-order-accept-return"));
    await waitFor(() => expect(canvas.getByTestId("at-return-accept")).toBeInTheDocument());
  },
};

// ── The forced return (a-return-is-received-by-search-then-forced, A) ─────────────────────────────────────────────

/**
 * FORCE RETURN ON THE ORDER PAGE — someone already looking at a shipped order, with its parcel back in hand. It confirms
 * in the owner's words, the order re-reads in `return`, and Accept Return takes the Force Return button's place.
 */
export const ForceReturnOnTheOrderPage: Story = {
  beforeEach: withOrderStatus(SHIPPED.id, OrderStatus.SHIPPED),
  render: () => <AtShipped />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("pick-order-accept-return")).toBeNull();
    await userEvent.click(await canvas.findByTestId("pick-order-force-return"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(
      screen.getByText(`Order #${SHIPPED.id} is "Shipped". Mark it as returned so you can accept it?`),
    ).toBeInTheDocument();
    await userEvent.click(confirm);

    await expect((await screen.findAllByText("Order marked as returned")).length).toBeGreaterThan(0);
    await waitFor(() => expect(canvas.getByTestId("pick-order-accept-return")).toBeInTheDocument());
    await expect(canvas.queryByTestId("pick-order-force-return")).toBeNull();

    await userEvent.click(canvas.getByTestId("pick-order-accept-return"));
    await waitFor(() => expect(canvas.getByTestId("at-return-accept")).toBeInTheDocument());
  },
};

/** …only for a parcel that left: a pending order is confirmed, never forced back. */
export const ForceReturnIsOnlyForAParcelThatLeft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("pick-order-advance")).toBeInTheDocument();
    await expect(canvas.queryByTestId("pick-order-force-return")).toBeNull();
  },
};

// ── Set Picked is the scan's (the-item-scans-live-on-the-page, the-pick-page-opens-first-by-the-label) ────────────────

/** What a handheld scanner does: types the whole code, then presses Enter. */
async function scan(input: HTMLElement, code: string) {
  await userEvent.type(input, `${code}{Enter}`, { delay: 10 });
}

/**
 * ONE PAGE: THE RACKS FOR THE WALK, THEN THE ITEM SCANS, THEN SET PICKED. An item not on the order is refused, every line
 * counts up to its quantity, Set Picked turns on only when every line is exact, one more is refused, and Set Picked is
 * the one write — processed → picked.
 */
export const SetPickedIsTheScans: Story = {
  render: () => <AtProcessed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const scanCard = await canvas.findByTestId("pick-scan", {}, { timeout: 4000 });
    // The racks first: the pick list sits above the scan.
    const list = canvas.getByTestId("pick-list-table");
    await expect(list.compareDocumentPosition(scanCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const input = canvas.getByTestId("pick-scan-input");
    await waitFor(() => expect(input).toHaveFocus());
    const setPicked = canvas.getByTestId("pick-order-set-picked");
    await expect(setPicked).toHaveTextContent("Set Picked");
    await expect(setPicked).toBeDisabled();

    await scan(input, "NO-SUCH-SKU");
    await expect(canvas.getByTestId("pick-scan-problem")).toHaveTextContent("Not on this order: NO-SUCH-SKU");
    await expect(setPicked).toBeDisabled();

    for (const line of PROCESSED.items) {
      for (let n = 0; n < line.quantity; n += 1) {
        await scan(input, line.productCode.toLowerCase());
      }
      await waitFor(() => expect(canvas.getByTestId(`pick-scan-line-${line.id}`)).toHaveAttribute("data-exact", "true"));
    }
    await waitFor(() => expect(canvas.getByTestId("pick-scan-complete")).toBeInTheDocument());
    await expect(canvas.queryByTestId("pick-scan-problem")).toBeNull();
    await expect(setPicked).toBeEnabled();

    // One more of the first line is too many — refused, and the count stays exact.
    const first = PROCESSED.items[0]!;
    await scan(input, first.productCode);
    await expect(canvas.getByTestId("pick-scan-problem")).toHaveTextContent("more than ordered");
    await expect(canvas.getByTestId(`pick-scan-line-${first.id}`)).toHaveTextContent(`${first.quantity} / ${first.quantity}`);

    await userEvent.click(setPicked);
    await expect((await screen.findAllByText("Marked picked")).length).toBeGreaterThan(0);
    await expect(statusChangeScenario.calls.at(-1)).toEqual({
      teamId: WAREHOUSE.id,
      orderIds: [PROCESSED.id],
      to: OrderStatus.PICKED,
    });
  },
};

/** NO PLAIN "MARK PICKED": a processed order offers no step button — the scan is the only way to picked. */
export const NoPlainMarkPicked: Story = {
  render: () => <AtProcessed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("pick-scan", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("pick-order-advance")).toBeNull();
    await expect(canvas.queryByText("Mark Picked")).toBeNull();
    // The barcode is parked, and says so where the scan is.
    await expect(canvas.getAllByTestId("not-implemented-barcode").length).toBeGreaterThan(0);
  },
};

/** ONLY A PROCESSED ORDER IS SCANNED — pending is confirmed first. */
export const OnlyAProcessedOrderIsScanned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("pick-order-advance")).toHaveTextContent("Confirm Order");
    await expect(canvas.queryByTestId("pick-scan")).toBeNull();
  },
};

const PICKED = orders.find((o) => o.warehouseId === WAREHOUSE.id && o.status === OrderStatus.PICKED)!;
const AtPicked = Routed(`/warehouse-orders/${PICKED.id}`);

/** …and a picked one is handed over next, with no scan left on it. */
export const APickedOrderGoesToTheHandover: Story = {
  render: () => <AtPicked />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("pick-order-advance")).toHaveTextContent("Mark Handed Over");
    await expect(canvas.queryByTestId("pick-scan")).toBeNull();
  },
};

/** A MONITOR READS THE PAGE ONLY — the racks and the lines, and no item scan, no Set Picked, no step. */
export const AMonitorReadsThePickPageOnly: Story = {
  beforeEach: () => {
    asAdminTeam()();
    asTeam(WAREHOUSE.id)();
  },
  render: () => <AtProcessed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-list-table")).toBeInTheDocument(), { timeout: 4000 });
    await expect(canvas.queryByTestId("pick-scan")).toBeNull();
    await expect(canvas.queryByTestId("pick-order-set-picked")).toBeNull();
    await expect(canvas.queryByTestId("pick-order-advance")).toBeNull();
  },
};
