import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

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

const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const OTHER_WAREHOUSE = teams[3]!; // Gudang Cabang (14)
const SELLER = teams[1]!; // Toko Melati (12)

const HERE = orders.filter((o) => o.warehouseId === WAREHOUSE.id);
const NEW_HERE = HERE.filter((o) => o.status === OrderStatus.PLACED); // 101, 102, 110
// Kenanga's — a seller whose own list Melati never sees, shipping from this floor.
const KENANGAS = HERE.find((o) => o.teamId === teams[2]!.id && o.status === OrderStatus.PLACED)!; // 110
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

    const confirmed = HERE.find((o) => o.status === OrderStatus.CONFIRMED)!; // 103

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
