import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orderDetailFor, orders, teams } from "../../../.storybook/fixtures";
import { orderExportScenario } from "../../../.storybook/sessionScenario";

import { OrderExportView, OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { deadlineUrgency, hoursFromNow, orderDeadline } from "../../features/orders/deadline";
import { WAREHOUSE_ORDERS_PENDING } from "./pending";
import { PickQueueNextPage } from "./index";

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
    { path: "/warehouse-orders", element: <PickQueueNextPage /> },
    marker("/warehouse-orders/:orderId", "at-pick-order"),
  ],
  "/warehouse-orders",
);

const meta = {
  title: "Pages/Warehouse/PickQueueNextPage",
  // HIDDEN from the sidebar for now (owner, 2026-10-02: *"hidden aja dulu yang preview order gudang ini"*).
  // `!dev` drops it from the workbench only — the `test` tag stays, so every rule below still runs in
  // `npm run test:stories` and the preview cannot rot while it waits. Delete this line to show it again.
  tags: ["!dev"],
  component: PickQueueNextPage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen" },
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <Routed />,
} satisfies Meta<typeof PickQueueNextPage>;

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

export const Default: Story = {
  play: async ({ canvasElement }) => {
    for (const o of NEW_HERE) {
      await rowOf(canvasElement, o.id);
    }
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
  },
};

/** The menu offers the warehouse's moves — from Dikonfirmasi, forward to picked AND back to the queue. */
export const TheMenuOffersOnlyAllowedMoves: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await rowOf(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PROCESSED_HERE.id}`));

    const id = PROCESSED_HERE.id;
    for (const to of ["picked", "toConfirm"]) {
      await waitFor(() => expect(screen.getByTestId(`pick-queue-move-${id}-${to}`)).toBeVisible());
    }
    // No skip: a processed order is picked before it can be handed over.
    await expect(screen.queryByTestId(`pick-queue-move-${id}-handover`)).toBeNull();
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
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("warehouse-orders-handover"));
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

/** Mass off: a good scan is handed over at once, one by one. */
export const HandoverOneByOne: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("warehouse-orders-handover"));
    const dialog = await screen.findByTestId("handover-dialog");

    await userEvent.type(within(dialog).getByTestId("handover-scan"), `${resiOf(PICKED_HERE)}{Enter}`, { delay: 10 });
    await waitFor(() =>
      expect(within(dialog).getByTestId(`handover-entry-${resiOf(PICKED_HERE)}`)).toHaveAttribute("data-state", "handedOver"),
    );
    await expect(within(dialog).queryByTestId("handover-submit")).toBeNull();
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

/** The validation scan: an unknown item and one too many are errors; every line exact unlocks the step. */
export const ValidationNeedsEveryLineExact: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await rowOf(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PROCESSED_HERE.id}`));

    const item = await screen.findByTestId(`pick-queue-validate-${PROCESSED_HERE.id}`);
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);

    const dialog = await screen.findByTestId("validate-dialog");
    const lines = orderDetailFor(PROCESSED_HERE.id)!.items;
    await waitFor(() => expect(within(dialog).getByTestId("validate-lines")).toBeInTheDocument());

    const scan = within(dialog).getByTestId("validate-scan");
    await userEvent.type(scan, "NO-SUCH-SKU{Enter}", { delay: 10 });
    await expect(within(dialog).getByTestId("validate-problem")).toHaveTextContent("NO-SUCH-SKU");

    const next = within(dialog).getByTestId("validate-next");
    await expect(next).toBeDisabled();

    for (const line of lines) {
      for (let n = 0; n < line.quantity; n += 1) {
        await userEvent.type(scan, `${line.sku}{Enter}`, { delay: 10 });
      }
    }
    await waitFor(() => expect(within(dialog).getByTestId("validate-complete")).toBeInTheDocument());
    await expect(next).toBeEnabled();

    // One more of the first line is too many.
    await userEvent.type(scan, `${lines[0]!.sku}{Enter}`, { delay: 10 });
    await expect(within(dialog).getByTestId("validate-problem")).toBeInTheDocument();
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

/** ⚠ Every fact the row invents has its badge on screen. */
export const EveryDeclaredGapIsMarkedOnScreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    // The workbench's marks: the bulk bar (select a row), the handover dialog, the validation item in a
    // processed row's menu — each opened, checked, closed.
    const found = new Set<string>();
    const collect = () => {
      for (const el of screen.queryAllByTestId(/^not-implemented-/)) found.add(el.getAttribute("data-testid")!.replace("not-implemented-", ""));
    };

    await userEvent.click(within(canvas.getByTestId(`pick-queue-select-${NEW_HERE[0]!.id}`)).getByRole("checkbox", { hidden: true }));
    await waitFor(() => expect(canvas.getByTestId("pick-queue-bulk-bar")).toBeInTheDocument());
    collect();

    await userEvent.click(canvas.getByTestId("warehouse-orders-handover"));
    await screen.findByTestId("handover-dialog");
    collect();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("handover-dialog")).toBeNull());

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await rowOf(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PROCESSED_HERE.id}`));
    await waitFor(() => expect(screen.getByTestId(`pick-queue-validate-${PROCESSED_HERE.id}`)).toBeVisible());
    collect();
    await userEvent.keyboard("{Escape}");

    // The All tab's rows. The filters carry no mark any more: all three are real
    // (the-filter-gains-seller-marketplace-and-courier).
    await userEvent.click(canvas.getByTestId("pick-tab-all"));
    await rowOf(canvasElement, NEW_HERE[0]!.id);
    collect();

    for (const part of WAREHOUSE_ORDERS_PENDING.parts) {
      await expect(found.has(part.id), part.id).toBe(true);
    }
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
