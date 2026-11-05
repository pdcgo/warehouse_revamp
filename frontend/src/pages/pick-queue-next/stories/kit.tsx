import { waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { orders, teams } from "../../../../.storybook/fixtures";

import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { PickQueueNextPage } from "../index";

// WHAT EVERY PICK-QUEUE STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` holds Default and Mobile, this folder one
// file per part. Each file keeps its own `title` and `tags` literals — Storybook reads both statically — and spreads the
// rest from here.
//
// THE WAREHOUSE'S ORDER LIST — the old system's columns, a PREVIEW
// (`the-warehouse-row-is-the-old-systems-columns`).
//
//   | story                              | the rule it pins                                           |
//   | ---------------------------------- | ---------------------------------------------------------- |
//   | Default / Mobile / WithoutTheMarks | the row, the phone's blocks, the layout without scaffolding |
//   | EveryColumnSaysItsFact             | person + team, shop + ref, courier + resi, qty, dates       |
//   | AnOverdueOrderTintsItsRow          | the deadline replaces the MP date's "ago", and late is loud |
//   | TheTabsAreTheWarehousesSteps       | to confirm + confirmed + picked + handed over + all, counted |
//   | CopyingDoesNotOpenTheOrder         | the ref and the resi copy without leaving the list          |
//   | TheFiltersAreTheCrews              | search, date, team, marketplace, courier                    |
//   | TheSellerFilterNarrowsTheRows      | picking a seller team leaves that team's orders only        |
//   | FiltersLiveInTheUrl                | the tab and filters are read from, and written to, the URL  |
//   | TheMenuOffersOnlyAllowedMoves      | Dikonfirmasi may go forward to picked, or back to the queue  |
//   | GoingBackAsksForAReason            | the warning dialog, and its button waits for a reason        |
//   | AForwardStepRunsForReal            | Perlu konfirmasi → Dikonfirmasi calls OrderStatusChange      |
//   | HandoverScanCollectsAndChecks      | mass: a picked parcel is ready, a rescan does not double,    |
//   |                                    | another step is an error, the button hands over the ready    |
//   | HandoverOneByOne                   | mass off: a good scan is handed over at once                 |
//   | FindParcelSoundsAMatch             | a wrong label is not it; the right one is a match            |
//   | ValidationNeedsEveryLineExact      | unknown and too many are errors; exact lines unlock the step |
//   | TheActionsAreThereFromTheStart     | the bar is always there; tick-only actions wait for a tick   |
//   | ARowOpensThePickList               | the row's way in                                            |
//   | ASellingTeamIsTurnedAway           | a seller has no shelves                                     |
//   | EveryDeclaredGapIsMarkedOnScreen   | each invented fact has its ⚠ on screen                      |

export const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

export const HERE = orders.filter((o) => o.warehouseId === WAREHOUSE.id);
export const NEW_HERE = HERE.filter((o) => o.status === OrderStatus.PENDING);
export const PROCESSED_HERE = HERE.find((o) => o.status === OrderStatus.PROCESSED)!;

const Routed = routedPage(
  [
    { path: "/warehouse-orders", element: <PickQueueNextPage /> },
    marker("/warehouse-orders/:orderId", "at-pick-order"),
  ],
  "/warehouse-orders",
);

/** Everything in a file's meta but its title and its tags. */
export const PICK_QUEUE_META = {
  component: PickQueueNextPage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen" },
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <Routed />,
};

/** The row's own element — a table row on a desktop canvas, a block on a phone (the runner is one). */
export async function rowOf(canvasElement: HTMLElement, id: bigint) {
  const canvas = within(canvasElement);
  return waitFor(() => canvas.queryByTestId(`pick-queue-row-${id}`) ?? canvas.getByTestId(`pick-queue-block-${id}`));
}
