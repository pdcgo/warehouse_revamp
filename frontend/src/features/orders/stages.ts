import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// THE EIGHT STATUSES THE OWNER DECIDED, as the screen reads them.
//
// `docs/business/order/context.md` §Order Status, recorded as `superseded-the-order-has-eight-statuses`:
// `pending · processed · shipped · completed · problem · lost · return · cancel`. That is the
// vocabulary the tabs and the summary both use here.
//
// ⚠ NINE NOW. `the-accept-is-the-status-return-completed` added `return_completed` after `return`, and
// this list has not taken it — where it sits on the tabs is open in `docs/technical/order/design_clarify.md`
// (#the-order-screens-count-eight-statuses-and-the-owner-added-a-ninth). The contract has neither.
//
// ⚠ THE CONTRACT IS FOUR SHORT AND ONE SPLIT. `OrderStatus` today is
// `placed · confirmed · picking · packed · shipped · cancelled`, which the owner's own clarify
// already records as stale and awaiting a migration. So:
//
//   pending    ← PLACED                              (a rename)
//   processed  ← CONFIRMED + PICKING + PACKED        (and a FOURTH step with no enum value)
//   shipped    ← SHIPPED
//   cancel     ← CANCELLED
//   completed · problem · lost · return ← NOTHING    (no enum value exists)
//
// ⚠ WHY THE FOLD IS RIGHT, and it is the owner's third use of the same rule: the ORDER carries the
// milestone, the record that owns the work carries its steps. `return-means-received-by-the-warehouse`
// put a return's transit on a return record, shipment tracking was deferred to the shipment, and
// picking/packed are the warehouse's own queue — not something the seller or the buyer reads off an
// order. The old system had already reached the same place by hand: its eleven statuses sat under a
// "diproses gudang" umbrella tab that hid FOUR of them — `confirm · picking · packed · diserahkan ke
// kurir`. The handover is the warehouse's LAST step, not the shipment's first, so the boundary
// `processed → shipped` is the parcel starting to MOVE rather than the parcel changing hands.
//
// ⚠ THE COLOUR LIVES HERE ONLY BECAUSE IT CANNOT LIVE WHERE IT BELONGS YET.
// `OrderStatusBadge` owns the colour of an order status, and it is keyed on the proto enum — which
// has no `completed`, `problem`, `lost` or `return` to key on. The day the enum grows, these move
// into that badge and this field is deleted; a second colour table is exactly the drift CLAUDE.md
// warns about, so it is temporary on purpose.

export type OrderStageId =
  | "pending"
  | "processed"
  | "shipped"
  | "completed"
  | "problem"
  | "lost"
  | "return"
  | "cancel";

export interface OrderStage {
  id: OrderStageId;
  /**
   * The proto statuses this stage sums.
   *
   * ⚠ EMPTY MEANS THE CONTRACT HAS NO SUCH STATUS — not that the stage is always empty. A count of
   * 0 on one of these is "nothing can be here yet", which is why they carry a mark on screen.
   */
  statuses: OrderStatus[];
  /** Categorical, not a role: these tell stages apart, they do not say good or bad. */
  color: string;
}

// The hues are the OLD SYSTEM'S, given by the owner (2026-09-24) and folded onto the eight the way
// the statuses were. Carried over rather than re-picked: people have been reading these colours for
// years, and a new palette would cost that for nothing.
//
// ⚠ A HUE, NEVER A ROLE. `amber` not `warning`, `sky` not `info` — an order's lifecycle step is
// CATEGORICAL colour, the example CLAUDE.md itself names. The four Tailwind ramps were registered
// under their own names in theme.ts so this could be written honestly.
export const ORDER_STAGES: OrderStage[] = [
  { id: "pending", statuses: [OrderStatus.PLACED], color: "amber" },
  {
    id: "processed",
    statuses: [OrderStatus.CONFIRMED, OrderStatus.PICKING, OrderStatus.PACKED],
    color: "sky",
  },
  { id: "shipped", statuses: [OrderStatus.SHIPPED], color: "blue" },
  { id: "completed", statuses: [], color: "green" },
  { id: "problem", statuses: [], color: "purple" },
  // ⚠ SAME PURPLE AS `problem`, ON PURPOSE (owner, 2026-09-24). Both say "something is not right", and
  // the label carries which. Raised as a collision and kept — do not "fix" it.
  { id: "lost", statuses: [], color: "purple" },
  // The old system had TWO returns — red while being processed, pink once accepted. Ours means
  // ACCEPTED (`return-means-received-by-the-warehouse`), so it takes that one's colour.
  { id: "return", statuses: [], color: "pink" },
  // ⚠ ROSE IS ALSO THIS APP'S ACCENT, worn by every primary button. Raised and kept (owner) — the
  // tone is shared but the step is not: a badge sits at `rose.100`, a button at `rose.600`.
  { id: "cancel", statuses: [OrderStatus.CANCELLED], color: "rose" },
];

/** The "no status filter" tab. Not a stage — it is the absence of one. */
export const ALL_STAGE = "all";

export function orderStage(id: string): OrderStage | undefined {
  return ORDER_STAGES.find((stage) => stage.id === id);
}

/**
 * Whether this stage can be asked for at all.
 *
 * ⚠ `processed` is BUILDABLE BUT NOT FILTERABLE, and the two are different failures.
 * `OrderListFilter.status` takes ONE status, so a stage covering three of them cannot be expressed —
 * the count is summable client-side from the census, the table behind it is not.
 */
export function stageIsOnTheWire(stage: OrderStage): boolean {
  return stage.statuses.length > 0;
}

export function stageCanFilterTheList(stage: OrderStage): boolean {
  return stage.statuses.length === 1;
}


// ── THE FOUR STEPS INSIDE `processed` (owner) ─────────────────────────────────────────────────────
//
// Folding them into one status does not make them disappear from the building: a seller still asks
// "how many are waiting to be packed?". They are shown as a breakdown of the selected pile, never as
// tabs — tabs are the order's statuses, and these are the warehouse's work.
//
// ⚠ THE FOURTH HAS NO ENUM VALUE. `OrderStatus` ends at `PACKED`, and the old system's "diserahkan ke
// kurir" — the moment the parcel changes hands, before it starts moving — has nothing to count.

export interface ProcessedStep {
  id: "confirm" | "picking" | "picked" | "packed" | "handover";
  /** Undefined = the contract has no status for this step, so it can only be marked, never counted. */
  status?: OrderStatus;
}

export const PROCESSED_STEPS: ProcessedStep[] = [
  { id: "confirm", status: OrderStatus.CONFIRMED },
  { id: "picking", status: OrderStatus.PICKING },
  // SUDAH DIAMBIL — picking done, not yet packed (owner, 2026-10-01: *"kalau belum ada bisa ditambahkan"*).
  // It is the queue at the packing table when the person who picks is not the person who packs. No status
  // for it yet, so it is offered and disabled, like the handover.
  { id: "picked" },
  { id: "packed", status: OrderStatus.PACKED },
  { id: "handover" },
];

/**
 * Which stage an order's proto status belongs to.
 *
 * ⚠ THIS IS WHAT STOPS THE TABS AND THE ROWS DISAGREEING. The tabs are written in the owner's eight
 * and `OrderStatusBadge` is keyed on the old six, so without it a table reads "Diproses" across the
 * top and "Packed" down the rows — two names for one order. It goes when the enum migrates.
 */
export function stageOfStatus(status: OrderStatus): OrderStage | undefined {
  return ORDER_STAGES.find((stage) => stage.statuses.includes(status));
}
