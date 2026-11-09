import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orders, teams } from "../../../.storybook/fixtures";
import {
  asAdminTeam,
  labelScanScenario,
  orderExportScenario,
  orderLabelScenario,
  returnAcceptScenario,
  statusChangeScenario,
  withOrderStatus,
  withOrdersInReturn,
  withSharedLabel,
} from "../../../.storybook/sessionScenario";

import { OrderExportView, OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { deadlineUrgency, hoursFromNow, orderDeadline } from "../../features/orders/deadline";
import { PickQueuePage } from "./index";

// THE WAREHOUSE'S ORDER LIST — /warehouse-orders, the old system's columns (`the-warehouse-row-is-the-old-systems-columns`),
// live since its gaps were closed (`the-warehouse-order-list-is-accepted`).
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
//   | TheMenuNeverOffersPicked           | Dikonfirmasi only goes back — picked is the pick page's scan |
//   | ChangeStepNeverOffersPicked        | the bulk Change Step leaves Sudah diambil out too            |
//   | GoingBackAsksForAReason            | the warning dialog, and its button waits for a reason        |
//   | AForwardStepRunsForReal            | Perlu konfirmasi → Dikonfirmasi calls OrderStatusChange      |
//   | HandoverScanCollectsAndChecks      | mass: a picked parcel is ready, a rescan does not double,    |
//   |                                    | another step is an error, the button hands over the ready    |
//   | HandoverOneByOne                   | mass off: a good scan is handed over at once                 |
//   | FindParcelSoundsAMatch             | a wrong label is not it; the right one is a match            |
//   | TheActionsAreThereFromTheStart     | the bar is always there; tick-only actions wait for a tick   |
//   | HandOverSkipsWhatIsNotPicked       | the bar's Hand Over skips what is not picked, and says so    |
//   | NothingMatchesSaysSoAndClears      | the empty hint, its Clear Filters, the pager still on screen |
//   | ARowOpensThePickList               | the row's way in                                            |
//   | ASellingTeamIsTurnedAway           | a seller has no shelves                                     |
//   | NoMarkIsLeft                       | every gap is closed — no ⚠ anywhere on the list             |
//   | PrintLabelsMergesTheTickedRows     | one OrderLabels for every ticked row, in the list's order;  |
//   |                                    | the merged PDF opens and the toast names who is left out    |
//   | PrintLabelsWithNothingPrintable    | nothing opens, and every order says why                     |
//   | ScanLabelOpensItsPickPage …        | Scan Label: one live order opens its pick page (resi, ref)  |
//   | ScanLabelListsSeveralAndOpensNone  | two live orders on one label: both listed, none opened      |
//   | ScanLabelSkipsACancelledTwin       | one live + one cancelled: the live one opens                |
//   | ScanLabelNone… / …OnlyCancelled…   | the wrong sound's sentences; nothing opens                  |
//   | HandoverShowsSeveralAndHandsNone   | the handover's server lookup: several shown, none moved     |
//   | HandoverSkipsACancelledTwin        | …a cancelled twin is skipped, the live one handed over      |
//   | TheReturnsTabListsBoth             | Retur = return + return_completed, counted, in the URL      |
//   | TheReturnWarehouseLists… / Another… | the configured return warehouse's returns, and only those   |
//   | Receive…                           | Receive a Return: accept, force then accept, not found, why  |
//   | AMonitorSeesNoWrites               | a monitoring team reads, prints and exports — never moves    |
//   | Phone                              | the one-row header: three actions fold into ⋯                |

const WAREHOUSE = teams[0]!; // Gudang Pusat (11)
const SELLER = teams[1]!; // Toko Melati (12)

const HERE = orders.filter((o) => o.warehouseId === WAREHOUSE.id);
const NEW_HERE = HERE.filter((o) => o.status === OrderStatus.PENDING);
const OVERDUE = NEW_HERE.find((o) => {
  const deadline = orderDeadline(o);
  return deadline !== undefined && deadlineUrgency(hoursFromNow(deadline)) === "overdue";
});
const WITH_REF = NEW_HERE.find((o) => (o.orderExternalRefId ?? "") !== "")!;
const PICKED_HERE = HERE.find((o) => o.status === OrderStatus.PICKED)!;
const PROCESSED_HERE = HERE.find((o) => o.status === OrderStatus.PROCESSED)!;
const resiOf = (o: { receiptCode: string }) => o.receiptCode;
const REF = WITH_REF.orderExternalRefId ?? "";

const Routed = routedPage(
  [
    { path: "/warehouse-orders", element: <PickQueuePage /> },
    marker("/warehouse-orders/:orderId", "at-pick-order"),
  ],
  "/warehouse-orders",
);

const meta = {
  title: "Pages/Warehouse/PickQueuePage",
  component: PickQueuePage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen" },
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <Routed />,
} satisfies Meta<typeof PickQueuePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * WHERE THE FILTER CONTROLS ARE. On a phone every control but the search sits in a bottom sheet behind
 * the Filter button, and the runner's canvas is phone-width — so open it when it is there.
 */
async function filterControls(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const open = canvas.queryByTestId("warehouse-orders-filters-open");

  if (!open) return canvas;

  await userEvent.click(open);
  const sheet = await screen.findByTestId("warehouse-orders-filters-sheet");
  await waitFor(() => expect(sheet).toBeVisible());

  return within(sheet);
}

/** The row's own element — a table row on a desktop canvas, a block on a phone (the runner is one). */
async function rowOf(canvasElement: HTMLElement, id: bigint) {
  const canvas = within(canvasElement);
  return waitFor(() => canvas.queryByTestId(`pick-queue-row-${id}`) ?? canvas.getByTestId(`pick-queue-block-${id}`));
}

/** No row of this order on screen — neither a table row nor a phone block. */
async function noRowOf(canvasElement: HTMLElement, id: bigint) {
  const canvas = within(canvasElement);
  await waitFor(() =>
    expect(canvas.queryByTestId(`pick-queue-row-${id}`) ?? canvas.queryByTestId(`pick-queue-block-${id}`)).toBeNull(),
  );
}

/**
 * A HEADER ACTION — its labelled button on a desktop, its icon on a phone, or, past two of them, a line of the ⋯ menu
 * (a-phone-header-action-is-an-icon). The menu's lines are portalled, so the header's own is looked for in the canvas.
 */
async function headerAction(canvasElement: HTMLElement, testId: string) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("warehouse-orders-header", {}, { timeout: 4000 });

  const inline = canvas.queryByTestId(testId);
  if (inline) {
    await userEvent.click(inline);
    return;
  }

  await userEvent.click(canvas.getByTestId("warehouse-orders-actions"));
  const item = await screen.findByTestId(testId);
  await waitFor(() => expect(item).toBeVisible());
  await userEvent.click(item);
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    for (const o of NEW_HERE) {
      await rowOf(canvasElement, o.id);
    }
    // The growing pager, on screen on one page too (every-list-pages-with-the-growing-pager).
    await expect(within(canvasElement).getByTestId("pick-queue-pager")).toBeInTheDocument();
  },
};

// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

export const WithoutTheMarks: Story = {
  globals: { pendingMarks: "off" },
};

/** Every column the owner named says its fact — the team is real, the marketplace ref is real. */
export const EveryColumnSaysItsFact: Story = {
  play: async ({ canvasElement }) => {
    const row = await rowOf(canvasElement, WITH_REF.id);
    const seller = teams.find((team) => team.id === WITH_REF.teamId)!;

    await waitFor(() => expect(row).toHaveTextContent(seller.name));
    await expect(row).toHaveTextContent(REF);
  },
};

/**
 * LATE IS LOUD — the deadline takes the MP date's second line when the order has one, and an overdue
 * order tints its whole row (or block), as on the seller's list.
 */
export const AnOverdueOrderTintsItsRow: Story = {
  play: async ({ canvasElement }) => {
    if (!OVERDUE) return; // the fixtures always carry one; the guard keeps a changed fixture honest
    const row = await rowOf(canvasElement, OVERDUE.id);

    await expect(row).toHaveAttribute("data-overdue", "true");
    await expect(within(row).getByTestId("order-deadline")).toHaveAttribute("data-urgency", "overdue");
  },
};

/**
 * THE TABS ARE THE WAREHOUSE'S STEPS (owner — `the-warehouse-tabs-are-the-processed-steps`): it opens
 * on Perlu konfirmasi with its count, Dikonfirmasi narrows to processed only, and Sudah diserahkan — a
 * status of its own now (shipping) — is a real tab with its count.
 */
export const TheTabsAreTheWarehousesSteps: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("pick-tab-count-toConfirm")).toHaveTextContent(String(NEW_HERE.length)),
    );
    await expect(canvas.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByTestId("pick-tab-handover")).toBeEnabled();
    await expect(canvas.getByTestId("pick-tab-count-handover")).toBeInTheDocument();

    // …and a row says what its tab says — "To confirm", not the status's own "Pending".
    const row = await rowOf(canvasElement, NEW_HERE[0]!.id);
    await expect(within(row).getByTestId(`order-status-${OrderStatus.PENDING}`)).toHaveTextContent("To confirm");

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    for (const o of NEW_HERE) {
      await waitFor(() =>
        expect(canvas.queryByTestId(`pick-queue-row-${o.id}`) ?? canvas.queryByTestId(`pick-queue-block-${o.id}`)).toBeNull(),
      );
    }
  },
};

/** The ref and the resi are carried elsewhere — copying them must not open the order. */
export const CopyingDoesNotOpenTheOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await rowOf(canvasElement, WITH_REF.id);

    const copy = within(row).queryAllByRole("button").find((b) => b.textContent?.includes(REF));
    await expect(copy).toBeDefined();
    await userEvent.click(copy!);
    await expect(canvas.queryByTestId("at-pick-order")).toBeNull();
  },
};

/** The crew's filters — search, date, team, marketplace, courier. No "filter type", no second status. */
export const TheFiltersAreTheCrews: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await expect(canvas.getByTestId("warehouse-orders-search")).toBeInTheDocument();
    const controls = await filterControls(canvasElement);
    await expect(controls.getByTestId("warehouse-orders-date")).toBeInTheDocument();
    await expect(controls.getByTestId("warehouse-orders-team-filter")).toBeInTheDocument();
    await expect(controls.getByTestId("warehouse-orders-marketplace-filter")).toBeInTheDocument();
    await expect(controls.getByTestId("warehouse-orders-courier-filter")).toBeInTheDocument();
  },
};

/**
 * THE ROW NAMES ITS REAL SHOP AND COUNTS ITS UNITS (the-warehouse-row-fills-from-shop-and-user-by-ids): the shop comes
 * from one ShopByIds read for the page, the count from the list's `item_quantity` — order 101 is Melati Official, and
 * its three lines hold 2 + 1 + 1 units.
 */
export const TheRowNamesItsShopAndCountsItsUnits: Story = {
  play: async ({ canvasElement }) => {
    const row = await rowOf(canvasElement, 101n);

    await waitFor(() => expect(row).toHaveTextContent("Melati Official"));

    // Its own column on a desktop row; "Qty 4" on a phone block.
    const qtyCell = within(canvasElement).queryByTestId("pick-queue-qty-101");
    if (qtyCell) {
      await expect(qtyCell).toHaveTextContent(/^4$/);
    } else {
      await expect(row).toHaveTextContent(/Qty\s*4/);
    }
  },
};

// THE STEP AND THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the tab and the search
// are its; another tab is written back beside the search.
const AtFilteredUrl = routedPage(
  [{ path: "/warehouse-orders", element: <><PickQueuePage /><LocationProbe /></> }],
  "/warehouse-orders?step=all&q=melati",
);

export const FiltersLiveInTheUrl: Story = {
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByTestId("warehouse-orders-search", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(search).toHaveValue("melati");
    await expect(canvas.getByTestId("pick-tab-all")).toHaveAttribute("aria-selected", "true");

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await waitFor(() => expect(location).toHaveTextContent("step=confirm"));
    await expect(location).toHaveTextContent("q=melati");
  },
};

/**
 * THE SELLER FILTER NARROWS THE ROWS (the-filter-gains-seller-marketplace-and-courier). Gudang Pusat ships for Toko
 * Melati and Toko Kenanga; picking Kenanga leaves Kenanga's order and drops Melati's.
 */
export const TheSellerFilterNarrowsTheRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const kenanga = teams.find((t) => t.teamCode === "SL-02")!;
    const kenangaOrder = HERE.find((o) => o.teamId === kenanga.id)!;

    await userEvent.click(canvas.getByTestId("pick-tab-all"));
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    const controls = await filterControls(canvasElement);
    await userEvent.click(within(controls.getByTestId("warehouse-orders-team-filter")).getByRole("combobox"));

    const option = await screen.findByTestId(`team-select-option-${kenanga.teamCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() =>
      expect(
        canvas.queryByTestId(`pick-queue-row-${NEW_HERE[0]!.id}`) ?? canvas.queryByTestId(`pick-queue-block-${NEW_HERE[0]!.id}`),
      ).toBeNull(),
    );
    await rowOf(canvasElement, kenangaOrder.id);
    // Every option is a selling team, so the pick reads as its name alone (a-one-type-picker-shows-the-name-alone).
    await expect(
      within(controls.getByTestId("warehouse-orders-team-filter")).queryByTestId(`team-type-badge-${kenanga.type}`),
    ).toBeNull();
  },
};

/**
 * THE MENU NEVER OFFERS SUDAH DIAMBIL (the-item-scans-live-on-the-page): a Dikonfirmasi order only goes back to the
 * queue from here — it is picked on its pick page, after every line is scanned exact, and Open Pick List is the way
 * there. No skip to the handover either, and no scan of its own on the list any more.
 */
export const TheMenuNeverOffersPicked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await rowOf(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PROCESSED_HERE.id}`));

    const id = PROCESSED_HERE.id;
    await waitFor(() => expect(screen.getByTestId(`pick-queue-move-${id}-toConfirm`)).toBeVisible());
    await expect(screen.getByTestId(`pick-queue-open-${id}`)).toBeVisible();
    await expect(screen.queryByTestId(`pick-queue-move-${id}-picked`)).toBeNull();
    await expect(screen.queryByTestId(`pick-queue-move-${id}-handover`)).toBeNull();
    await expect(screen.queryByTestId(`pick-queue-validate-${id}`)).toBeNull();
  },
};

/** …nor does the bulk Change Step: a ticked Dikonfirmasi order can only go back. */
export const ChangeStepNeverOffersPicked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await tick(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId("pick-queue-bulk-move"));

    await waitFor(() => expect(screen.getByTestId("pick-queue-bulk-move-toConfirm")).toBeVisible());
    await expect(screen.queryByTestId("pick-queue-bulk-move-picked")).toBeNull();
  },
};

/** Going back to the queue is a warning with a reason — the button waits until one is written. */
export const GoingBackAsksForAReason: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await rowOf(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PROCESSED_HERE.id}`));

    const back = await screen.findByTestId(`pick-queue-move-${PROCESSED_HERE.id}-toConfirm`);
    await waitFor(() => expect(back).toBeVisible());
    await userEvent.click(back);

    const confirm = await screen.findByTestId("step-back-confirm");
    // Back goes to the queue — pending, Perlu konfirmasi (the-status-move-is-the-only-journey).
    await expect(within(await screen.findByTestId("step-back-dialog")).getByText("Back to To Confirm")).toBeInTheDocument();
    await expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByTestId("step-back-reason"), "Not on the shelf", { delay: 20 });
    await expect(confirm).toBeEnabled();
  },
};

/** A move runs for real, through OrderStatusChange: Perlu konfirmasi → Dikonfirmasi. */
export const AForwardStepRunsForReal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const order = NEW_HERE[0]!;
    await rowOf(canvasElement, order.id);

    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${order.id}`));
    const item = await screen.findByTestId(`pick-queue-move-${order.id}-confirm`);
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);

    await expect(await screen.findByText(/Moved to Confirmed/)).toBeInTheDocument();
  },
};

/**
 * THE HANDOVER SCAN, MASS MODE — a picked parcel is ready, the same label again does not double, a parcel
 * at another step is an error, and the button hands over what is ready (off while nothing is).
 */
export const HandoverScanCollectsAndChecks: Story = {
  play: async ({ canvasElement }) => {
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await headerAction(canvasElement, "warehouse-orders-handover");
    const dialog = await screen.findByTestId("handover-dialog");
    await userEvent.click(within(dialog).getByText("Mass pickup"));

    const submit = await within(dialog).findByTestId("handover-submit");
    await expect(submit).toBeDisabled();

    const scan = within(dialog).getByTestId("handover-scan");
    await userEvent.type(scan, `${resiOf(PICKED_HERE)}{Enter}`, { delay: 10 });
    await waitFor(() =>
      expect(within(dialog).getByTestId(`handover-entry-${resiOf(PICKED_HERE)}`)).toHaveAttribute("data-state", "ready"),
    );

    // The same label again — still one row.
    await userEvent.type(scan, `${resiOf(PICKED_HERE)}{Enter}`, { delay: 10 });
    await expect(within(dialog).getAllByTestId(`handover-entry-${resiOf(PICKED_HERE)}`)).toHaveLength(1);

    // A parcel still being picked (processed) — an error.
    await userEvent.type(scan, `${resiOf(PROCESSED_HERE)}{Enter}`, { delay: 10 });
    await waitFor(() =>
      expect(within(dialog).getByTestId(`handover-entry-${resiOf(PROCESSED_HERE)}`)).toHaveAttribute("data-state", "wrongStep"),
    );

    await expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() =>
      expect(within(dialog).getByTestId(`handover-entry-${resiOf(PICKED_HERE)}`)).toHaveAttribute("data-state", "handedOver"),
    );
  },
};

/** Mass off: a good scan is handed over at once, one by one — the label asked of the SERVER, not of the loaded rows. */
export const HandoverOneByOne: Story = {
  play: async ({ canvasElement }) => {
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await headerAction(canvasElement, "warehouse-orders-handover");
    const dialog = await screen.findByTestId("handover-dialog");

    await userEvent.type(within(dialog).getByTestId("handover-scan"), `${resiOf(PICKED_HERE)}{Enter}`, { delay: 10 });
    await waitFor(() =>
      expect(within(dialog).getByTestId(`handover-entry-${resiOf(PICKED_HERE)}`)).toHaveAttribute("data-state", "handedOver"),
    );
    await expect(within(dialog).queryByTestId("handover-submit")).toBeNull();
    await expect(labelScanScenario.searches).toContain(resiOf(PICKED_HERE));
    await expect(statusChangeScenario.calls.at(-1)).toEqual({
      teamId: WAREHOUSE.id,
      orderIds: [PICKED_HERE.id],
      to: OrderStatus.SHIPPING,
    });
  },
};

/** Finding a parcel in a sack: a wrong label is not it, the right one sounds a match — no server asked. */
export const FindParcelSoundsAMatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-picked"));
    await rowOf(canvasElement, PICKED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PICKED_HERE.id}`));

    const item = await screen.findByTestId(`pick-queue-find-${PICKED_HERE.id}`);
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);

    const dialog = await screen.findByTestId("find-parcel-dialog");
    const scan = within(dialog).getByTestId("find-parcel-scan");

    await userEvent.type(scan, "NOT-THIS-ONE{Enter}", { delay: 10 });
    await waitFor(() => expect(within(dialog).getByTestId("find-parcel-result")).toHaveAttribute("data-match", "false"));

    await userEvent.type(scan, `${resiOf(PICKED_HERE)}{Enter}`, { delay: 10 });
    await waitFor(() => expect(within(dialog).getByTestId("find-parcel-result")).toHaveAttribute("data-match", "true"));
  },
};

/**
 * THE ACTIONS ARE ON SCREEN FROM THE START (owner). With nothing ticked the bar says to tick, the actions
 * that need a selection are off, and Export is on (the whole filtered list); a tick turns them on.
 */
export const TheActionsAreThereFromTheStart: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const order = NEW_HERE[0]!;
    await rowOf(canvasElement, order.id);

    await expect(canvas.getByTestId("pick-queue-bulk-hint")).toBeInTheDocument();
    await expect(canvas.getByTestId("pick-queue-bulk-move")).toBeDisabled();
    await expect(canvas.getByTestId("pick-queue-bulk-print")).toBeDisabled();
    await expect(canvas.getByTestId("pick-queue-bulk-handover")).toBeDisabled();
    await expect(canvas.getByTestId("pick-queue-bulk-export")).toBeEnabled();

    await userEvent.click(within(canvas.getByTestId(`pick-queue-select-${order.id}`)).getByRole("checkbox", { hidden: true }));
    await waitFor(() => expect(canvas.getByTestId("pick-queue-bulk-count")).toHaveTextContent("1 selected"));
    await expect(canvas.getByTestId("pick-queue-bulk-print")).toBeEnabled();
    await expect(canvas.getByTestId("pick-queue-bulk-handover")).toBeEnabled();

    await userEvent.click(canvas.getByTestId("pick-queue-bulk-clear"));
    await waitFor(() => expect(canvas.getByTestId("pick-queue-bulk-hint")).toBeInTheDocument());
  },
};

/**
 * HAND OVER TAKES THE PICKED ONLY — a ticked order still waiting to be confirmed is skipped, and the toast says it is
 * not picked yet (the handover is picked → shipping, one-status-change-for-every-plain-move).
 */
export const HandOverSkipsWhatIsNotPicked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await tick(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-queue-bulk-handover"));
    await expect((await screen.findAllByText("1 not picked yet — skipped")).length).toBeGreaterThan(0);
  },
};

// NOTHING MATCHES (an-empty-list-shows-a-hint) — opened at a search no order has.
const AtNoMatch = routedPage(
  [{ path: "/warehouse-orders", element: <PickQueuePage /> }],
  "/warehouse-orders?step=all&q=zzz-no-such-order",
);

/**
 * AN EMPTY LIST SAYS WHY AND WHAT NEXT (an-empty-list-shows-a-hint): a search that matches nothing shows the hint with
 * its own Clear Filters, the pager stays on screen, and clearing brings the rows back.
 */
export const NothingMatchesSaysSoAndClears: Story = {
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("pick-queue-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No orders match these filters.");
    await expect(canvas.getByTestId("pick-queue-pager")).toBeInTheDocument();

    await userEvent.click(within(empty).getByTestId("pick-queue-empty-clear"));
    await rowOf(canvasElement, NEW_HERE[0]!.id);
    await expect(canvas.getByTestId("warehouse-orders-search")).toHaveValue("");
  },
};

export const ARowOpensThePickList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await rowOf(canvasElement, NEW_HERE[0]!.id);

    const seller = teams.find((team) => team.id === NEW_HERE[0]!.teamId)!;
    await userEvent.click(await within(row).findByText(seller.name, { exact: false }));
    await waitFor(() => expect(canvas.getByTestId("at-pick-order")).toBeInTheDocument());
  },
};

export const ASellingTeamIsTurnedAway: Story = {
  beforeEach: asTeam(SELLER.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("pick-queue-not-warehouse")).toBeInTheDocument());
  },
};

/**
 * EVERY GAP IS CLOSED — the list carries no ⚠ any more: the label lookup is the server's (`resiLookup` gone), and the one
 * mark left, the barcode, lives on the pick page's item scan.
 */
export const NoMarkIsLeft: Story = {
  play: async ({ canvasElement }) => {
    await rowOf(canvasElement, NEW_HERE[0]!.id);
    await expect(screen.queryAllByTestId(/^not-implemented-/)).toHaveLength(0);

    await headerAction(canvasElement, "warehouse-orders-handover");
    await screen.findByTestId("handover-dialog");
    await expect(screen.queryAllByTestId(/^not-implemented-/)).toHaveLength(0);
  },
};

/**
 * THE BAR EXPORTS THE SELECTION WHEN THERE IS ONE (the-bulk-actions-are-always-on-screen) — in the warehouse's
 * columns, only the ticked order.
 */
export const ExportTakesTheTickedRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const order = NEW_HERE[0]!;

    await rowOf(canvasElement, order.id);
    await userEvent.click(within(canvas.getByTestId(`pick-queue-select-${order.id}`)).getByRole("checkbox", { hidden: true }));
    await userEvent.click(canvas.getByTestId("pick-queue-bulk-export"));

    await expect(await screen.findByText("Export ready — the file is downloading")).toBeInTheDocument();

    const asked = orderExportScenario.last!;
    await expect(asked.view).toBe(OrderExportView.WAREHOUSE);
    await expect(asked.orderIds).toEqual([order.id]);
  },
};


/** The ticked rows' ids in the order the screen lists them — the order the labels are printed in. */
function listedOrder(canvasElement: HTMLElement, ids: bigint[]): bigint[] {
  const wanted = new Set(ids.map(String));
  const listed = [...canvasElement.querySelectorAll("[data-testid^='pick-queue-select-']")]
    .map((el) => el.getAttribute("data-testid")!.replace("pick-queue-select-", ""))
    .filter((id) => wanted.has(id));

  return [...new Set(listed)].map((id) => BigInt(id));
}

async function tick(canvasElement: HTMLElement, id: bigint) {
  const canvas = within(canvasElement);
  await rowOf(canvasElement, id);
  await userEvent.click(within(canvas.getByTestId(`pick-queue-select-${id}`)).getByRole("checkbox", { hidden: true }));
}

/**
 * PRINT LABELS PRINTS THE TICKED ROWS AS ONE PDF (a-warehouse-prints-the-labels-of-orders-it-ships): ONE OrderLabels with
 * every ticked id in the list's order; the merged PDF opens, and the toast names the order left out and why.
 */
export const PrintLabelsMergesTheTickedRows: Story = {
  beforeEach: () => {
    orderLabelScenario.labelled = [NEW_HERE[0]!.id, NEW_HERE[1]!.id];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [a, b, none] = [NEW_HERE[0]!, NEW_HERE[1]!, NEW_HERE[2]!];
    const open = spyOn(window, "open").mockReturnValue(null);

    for (const order of [a, b, none]) await tick(canvasElement, order.id);
    await waitFor(() => expect(canvas.getByTestId("pick-queue-bulk-count")).toHaveTextContent("3 selected"));

    await userEvent.click(canvas.getByTestId("pick-queue-bulk-print"));

    const sent = listedOrder(canvasElement, [a.id, b.id, none.id]);
    await waitFor(() => expect(orderLabelScenario.last).toEqual({ teamId: WAREHOUSE.id, orderIds: sent }));

    const printed = sent.filter((id) => id !== none.id).join("-");
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(`https://example.invalid/labels/merged-${printed}.pdf`, "_blank", "noopener,noreferrer"),
    );
    await expect(open).toHaveBeenCalledTimes(1);

    await expect((await screen.findAllByText("1 label is not in the PDF")).length).toBeGreaterThan(0);
    await expect(
      (await screen.findAllByText(`Order #${none.id} has no label attached yet — ask the seller to attach it`)).length,
    ).toBeGreaterThan(0);
    open.mockRestore();
  },
};

/** Nothing printable among the ticked rows: no PDF opens, and every order says why — a broken file and a missing one. */
export const PrintLabelsWithNothingPrintable: Story = {
  beforeEach: () => {
    orderLabelScenario.labelled = [NEW_HERE[0]!.id];
    orderLabelScenario.unreadable = [NEW_HERE[0]!.id];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [broken, none] = [NEW_HERE[0]!, NEW_HERE[2]!];
    const open = spyOn(window, "open").mockReturnValue(null);

    await tick(canvasElement, broken.id);
    await tick(canvasElement, none.id);
    await userEvent.click(canvas.getByTestId("pick-queue-bulk-print"));

    await expect((await screen.findAllByText("No label could be printed")).length).toBeGreaterThan(0);
    await expect(
      (await screen.findAllByText(`The label file of order #${broken.id} can't be read — ask the seller to upload it again`, { exact: false }))
        .length,
    ).toBeGreaterThan(0);
    await expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  },
};

// ── Scan Label (scan-label-opens-the-pick-page) ───────────────────────────────────────────────────────────────────
//
// The crew scans a parcel's label from the list's header; the code is asked of the server among this warehouse's orders.

/** Opens Scan Label and answers its field — focused, as a scanner needs it. */
async function openScanLabel(canvasElement: HTMLElement) {
  await rowOf(canvasElement, NEW_HERE[0]!.id);
  await headerAction(canvasElement, "warehouse-orders-scan-label");

  const input = await screen.findByTestId("scan-label-input");
  await waitFor(() => expect(input).toBeVisible());
  await waitFor(() => expect(input).toHaveFocus());

  return input;
}

/** What a handheld scanner does: types the whole code, then presses Enter. */
async function scan(input: HTMLElement, code: string) {
  await userEvent.type(input, `${code}{Enter}`, { delay: 10 });
}

/** ONE LIVE ORDER OPENS ITS PICK PAGE — by its tracking number, asked of the server. */
export const ScanLabelOpensItsPickPage: Story = {
  play: async ({ canvasElement }) => {
    const input = await openScanLabel(canvasElement);
    await scan(input, resiOf(PROCESSED_HERE));

    await waitFor(() => expect(within(canvasElement).getByTestId("at-pick-order")).toBeInTheDocument());
    await expect(labelScanScenario.searches).toContain(resiOf(PROCESSED_HERE));
    await expect(screen.queryByTestId("scan-label-dialog")).toBeNull();
  },
};

/** …and by the label's other barcode, the marketplace ref (a-label-scan-reads-the-ref-or-the-receipt), in any case. */
export const ScanLabelOpensItsPickPageByTheRef: Story = {
  play: async ({ canvasElement }) => {
    const input = await openScanLabel(canvasElement);
    await scan(input, REF.toLowerCase());

    await waitFor(() => expect(within(canvasElement).getByTestId("at-pick-order")).toBeInTheDocument());
  },
};

/**
 * TWO LIVE ORDERS ON ONE LABEL ARE SHOWN, NOT CHOSEN (two-orders-on-one-label-are-shown-not-chosen): both are listed with
 * what tells them apart and a warning to ask, and nothing opens — until the crew opens the one it was told to.
 */
export const ScanLabelListsSeveralAndOpensNone: Story = {
  beforeEach: withSharedLabel("SPX-TWIN-1", 103n, 104n),
  play: async ({ canvasElement }) => {
    const input = await openScanLabel(canvasElement);
    await scan(input, "SPX-TWIN-1");

    const result = await screen.findByTestId("scan-label-result");
    await waitFor(() => expect(result).toHaveAttribute("data-state", "several"));
    await expect(screen.getByTestId("scan-label-several")).toHaveTextContent("ask the selling team or the warehouse admin");
    await expect(screen.getByTestId("scan-label-match-103")).toHaveTextContent("#103");
    await expect(screen.getByTestId("scan-label-match-104")).toHaveTextContent("#104");
    await expect(within(canvasElement).queryByTestId("at-pick-order")).toBeNull();

    await userEvent.click(screen.getByTestId("scan-label-open-104"));
    await waitFor(() => expect(within(canvasElement).getByTestId("at-pick-order")).toBeInTheDocument());
  },
};

/** ONE LIVE AND ONE CANCELLED: the cancelled twin is skipped, so the live order opens straight away. */
export const ScanLabelSkipsACancelledTwin: Story = {
  beforeEach: [withSharedLabel("SPX-TWIN-2", 103n, 104n), withOrderStatus(104n, OrderStatus.CANCEL)],
  play: async ({ canvasElement }) => {
    const input = await openScanLabel(canvasElement);
    await scan(input, "SPX-TWIN-2");

    await waitFor(() => expect(within(canvasElement).getByTestId("at-pick-order")).toBeInTheDocument());
  },
};

/** NONE — a label of no order of this warehouse (another building's included): the wrong sound and a sentence. */
export const ScanLabelNoneSaysSo: Story = {
  play: async ({ canvasElement }) => {
    const elsewhere = orders.find((o) => o.warehouseId !== WAREHOUSE.id)!;
    const input = await openScanLabel(canvasElement);

    await scan(input, "NO-SUCH-LABEL");
    const result = await screen.findByTestId("scan-label-result");
    await waitFor(() => expect(result).toHaveAttribute("data-state", "none"));
    await expect(result).toHaveTextContent("No order of this warehouse carries NO-SUCH-LABEL.");

    // The field emptied itself after Enter, so the next scan is one of its own.
    await scan(input, resiOf(elsewhere));
    await waitFor(() => expect(result).toHaveTextContent(`carries ${resiOf(elsewhere)}.`));
    await expect(within(canvasElement).queryByTestId("at-pick-order")).toBeNull();
  },
};

/** ONLY A CANCELLED ORDER carries it — nothing to pick, and nothing opens. */
export const ScanLabelOnlyCancelledSaysSo: Story = {
  beforeEach: [withSharedLabel("SPX-GONE-1", 104n), withOrderStatus(104n, OrderStatus.CANCEL)],
  play: async ({ canvasElement }) => {
    const input = await openScanLabel(canvasElement);
    await scan(input, "SPX-GONE-1");

    const result = await screen.findByTestId("scan-label-result");
    await waitFor(() => expect(result).toHaveAttribute("data-state", "cancelled"));
    await expect(result).toHaveTextContent("Only a cancelled order carries SPX-GONE-1 (#104)");
    await expect(within(canvasElement).queryByTestId("at-pick-order")).toBeNull();
  },
};

// ── The handover's server lookup (two-orders-on-one-label-are-shown-not-chosen) ────────────────────────────────────

/** SEVERAL PICKED ORDERS ON ONE LABEL: the entry names every one, and NONE is handed over. */
export const HandoverShowsSeveralAndHandsNone: Story = {
  beforeEach: withSharedLabel("SPX-TWIN-3", 105n, 111n),
  play: async ({ canvasElement }) => {
    await rowOf(canvasElement, NEW_HERE[0]!.id);
    await headerAction(canvasElement, "warehouse-orders-handover");
    const dialog = await screen.findByTestId("handover-dialog");

    await userEvent.type(within(dialog).getByTestId("handover-scan"), "SPX-TWIN-3{Enter}", { delay: 10 });
    await waitFor(() => expect(within(dialog).getByTestId("handover-entry-SPX-TWIN-3")).toHaveAttribute("data-state", "several"));
    await expect(within(dialog).getByTestId("handover-several-SPX-TWIN-3")).toHaveTextContent("#111, #105");
    await expect(statusChangeScenario.calls).toHaveLength(0);
  },
};

/** …and a CANCELLED twin is skipped: the one live, picked order is handed over. */
export const HandoverSkipsACancelledTwin: Story = {
  beforeEach: [withSharedLabel("SPX-TWIN-4", 105n, 104n), withOrderStatus(104n, OrderStatus.CANCEL)],
  play: async ({ canvasElement }) => {
    await rowOf(canvasElement, NEW_HERE[0]!.id);
    await headerAction(canvasElement, "warehouse-orders-handover");
    const dialog = await screen.findByTestId("handover-dialog");

    await userEvent.type(within(dialog).getByTestId("handover-scan"), "SPX-TWIN-4{Enter}", { delay: 10 });
    await waitFor(() =>
      expect(within(dialog).getByTestId("handover-entry-SPX-TWIN-4")).toHaveAttribute("data-state", "handedOver"),
    );
    await expect(statusChangeScenario.calls.at(-1)?.orderIds).toEqual([105n]);
  },
};

// ── Retur (the-warehouse-list-has-a-returns-tab) ───────────────────────────────────────────────────────────────────

const RETURNED_ROW = orders.find((o) => o.id === 110n)!;

const AtReturnsProbe = routedPage(
  [
    { path: "/warehouse-orders", element: <><PickQueuePage /><LocationProbe /></> },
    marker("/warehouse-orders/:orderId", "at-pick-order"),
  ],
  "/warehouse-orders",
);

/**
 * RETUR IS BOTH — the parcels on their way back (110, `return`) and the ones accepted (102, `return_completed`), counted
 * together, after Sudah diserahkan, and kept in the URL; a pending order is not on it. A row opens its pick page.
 */
export const TheReturnsTabListsBoth: Story = {
  beforeEach: () => {
    returnAcceptScenario.inReturn = [110n];
    returnAcceptScenario.accepted = [102n];
  },
  render: () => <AtReturnsProbe />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tab = await canvas.findByTestId("pick-tab-return", {}, { timeout: 4000 });

    // After Sudah diserahkan, before Semua.
    const order = [...canvasElement.querySelectorAll("[data-testid^='pick-tab-']:not([data-testid^='pick-tab-count-'])")].map(
      (el) => el.getAttribute("data-testid"),
    );
    await expect(order).toEqual([
      "pick-tab-toConfirm",
      "pick-tab-confirm",
      "pick-tab-picked",
      "pick-tab-handover",
      "pick-tab-return",
      "pick-tab-all",
    ]);
    await waitFor(() => expect(canvas.getByTestId("pick-tab-count-return")).toHaveTextContent("2"));

    await userEvent.click(tab);
    await rowOf(canvasElement, 110n);
    await rowOf(canvasElement, 102n);
    await noRowOf(canvasElement, 101n);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("step=return"));

    const kenanga = teams.find((team) => team.id === RETURNED_ROW.teamId)!;
    await userEvent.click(await within(await rowOf(canvasElement, 110n)).findByText(kenanga.name, { exact: false }));
    await waitFor(() => expect(canvas.getByTestId("at-pick-order")).toBeInTheDocument());
  },
};

/**
 * THE CONFIGURED RETURN WAREHOUSE SEES WHAT IS COMING BACK TO IT (a-return-may-land-in-another-warehouse). Order 109 is
 * Toko Melati's and ships from Gudang Cabang — but Melati returns to Gudang Pusat, so once it is a return it is on Gudang
 * Pusat's Retur tab, beside its own. Before it is a return it is none of Gudang Pusat's business.
 */
export const TheReturnWarehouseListsReturnsItDidNotShip: Story = {
  beforeEach: withOrdersInReturn(109n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("pick-tab-return", {}, { timeout: 4000 }));
    await rowOf(canvasElement, 109n);

    await userEvent.click(canvas.getByTestId("pick-tab-all"));
    await rowOf(canvasElement, 109n);
  },
};

/** …and not before: the same order, still processed at Gudang Cabang, is on none of Gudang Pusat's tabs. */
export const AnotherWarehousesLiveOrderIsNotListed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("pick-tab-all", {}, { timeout: 4000 }));
    await rowOf(canvasElement, NEW_HERE[0]!.id);
    await noRowOf(canvasElement, 109n);
  },
};

// ── Receive a Return (a-return-is-received-by-search-then-forced, B) ───────────────────────────────────────────────
//
// The crew has a returned parcel in its hands: scan the label or type the ref, and the order is found among this
// warehouse's — then accepted, forced first, or refused in a sentence.

const RETURNED = orders.find((o) => o.id === 110n)!; // Kenanga's, ships from here — read in `return`
const SHIPPED_HERE = orders.find((o) => o.id === 106n)!; // Melati's, handed over here — read as `shipped`
const PENDING_HERE = orders.find((o) => o.id === 101n)!; // Melati's, never left the building
const SHIPS_ELSEWHERE = orders.find((o) => o.warehouseId !== WAREHOUSE.id)!; // 107, Gudang Cabang's

/** Opens Receive a Return from the header and answers its input, focused. */
async function openReceive(canvasElement: HTMLElement) {
  await headerAction(canvasElement, "pick-queue-receive");
  const input = await screen.findByTestId("receive-return-input");
  await waitFor(() => expect(input).toBeVisible());
  await waitFor(() => expect(input).toHaveFocus());

  return input;
}

/**
 * ALREADY IN RETURN — customer service claimed it first. The scanned tracking number finds it, with its shop and customer,
 * and its one step is Accept Return: the existing dialog opens on the order's lines, and the accept lands.
 */
export const ReceiveFindsAnOrderAlreadyInReturn: Story = {
  beforeEach: withOrdersInReturn(RETURNED.id),
  play: async ({ canvasElement }) => {
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

// ── Who may write (the-admin-team-monitors-read-only) ──────────────────────────────────────────────────────────────

/**
 * A MONITOR SEES NO WRITES. The admin team reading Gudang Pusat finds the rows, Scan Label (it only reads), Print Labels
 * and Export — and no Scan Handover, no Receive a Return, no Change Step, no Hand Over, and no move in a row's menu.
 */
export const AMonitorSeesNoWrites: Story = {
  beforeEach: () => {
    asAdminTeam()();
    asTeam(WAREHOUSE.id)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await expect(canvas.getByTestId("warehouse-orders-scan-label")).toBeInTheDocument();
    await expect(canvas.queryByTestId("warehouse-orders-actions")).toBeNull();
    await expect(canvas.queryByTestId("warehouse-orders-handover")).toBeNull();
    await expect(canvas.queryByTestId("pick-queue-receive")).toBeNull();

    await expect(canvas.queryByTestId("pick-queue-bulk-move")).toBeNull();
    await expect(canvas.queryByTestId("pick-queue-bulk-handover")).toBeNull();
    await expect(canvas.getByTestId("pick-queue-bulk-print")).toBeInTheDocument();
    await expect(canvas.getByTestId("pick-queue-bulk-export")).toBeEnabled();

    // A to-confirm row's menu: no Move to Confirmed, only what reads.
    const order = NEW_HERE[0]!;
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${order.id}`));
    await waitFor(() => expect(screen.getByTestId(`pick-queue-open-${order.id}`)).toBeVisible());
    await expect(screen.queryByTestId(`pick-queue-move-${order.id}-confirm`)).toBeNull();
    await expect(screen.queryAllByTestId(new RegExp(`^pick-queue-move-${order.id}-`))).toHaveLength(0);
  },
};

/**
 * ON A PHONE the header stays one row: the title, the team, then Scan Label as its own icon — pinned, the crew's action on
 * almost every order (scan-label-stays-an-icon-on-a-phone) — and one ⋯ holding Scan Handover and Receive a Return by name
 * (a-phone-header-action-is-an-icon).
 */
export const Phone: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    const menu = canvas.queryByTestId("warehouse-orders-actions");
    // The runner's canvas decides the shell: on a desktop-width canvas the header keeps its labelled buttons.
    if (!menu) {
      await expect(canvas.getByTestId("warehouse-orders-scan-label")).toHaveTextContent("Scan Label");
      return;
    }

    const title = canvas.getByRole("heading", { name: "Orders" });
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    await expect(Math.abs(centre(title) - centre(menu))).toBeLessThan(8);

    // Scan Label is an icon on the title's row, named for a screen reader — not a line of the menu.
    const scan = canvas.getByTestId("warehouse-orders-scan-label");
    await expect(scan).toHaveAttribute("aria-label", "Scan Label");
    await expect(Math.abs(centre(title) - centre(scan))).toBeLessThan(8);

    await userEvent.click(menu);
    for (const [id, name] of [
      ["warehouse-orders-handover", "Scan Handover"],
      ["pick-queue-receive", "Receive a Return"],
    ] as const) {
      const item = await screen.findByTestId(id);
      await waitFor(() => expect(item).toBeVisible());
      await expect(item).toHaveTextContent(name);
    }
  },
};
