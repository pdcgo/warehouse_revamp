import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
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
//   | TheNoteIsReadBeforeTheWalk      | the packing instruction sits on the crew's screen            |
//   | ThereIsOneNextStep              | PLACED → "Confirm Order", and it is recorded                 |
//   | AShippedOrderHasNoStepLeft      | the last step leaves nothing to press                        |
//   | AnOrderShippingElsewhereIsNot…  | the scope is this building                                   |
//   | ASellingTeamIsTurnedAway        | no shelves, no pick list                                     |

const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const SELLER = teams[1]!; // Toko Melati (12)

const FULL = orderDetailFor(101n)!; // PLACED, three lines, a note, an address
const SHIPPED = orders.find((o) => o.warehouseId === WAREHOUSE.id && o.status === OrderStatus.SHIPPED)!;
const ELSEWHERE = orders.find((o) => o.warehouseId !== WAREHOUSE.id)!; // 107, Gudang Cabang's

const Routed = (path: string) =>
  routedPage(
    [
      { path: "/warehouse-orders/:orderId", element: <PickOrderPage /> },
      marker("/warehouse-orders", "at-pick-queue"),
    ],
    path,
  );

const AtFull = Routed(`/warehouse-orders/${FULL.id}`);
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

/** THE NOTE IS ON THE CREW'S SCREEN — the one person it is written for is standing here. */
export const TheNoteIsReadBeforeTheWalk: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pick-order-note")).toHaveTextContent(FULL.note));
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
