import type { DayHours, WarehouseReceivingState } from "../../gen/warehouse/warehouse/v1/warehouse_info_pb";

// WHAT "NOT SET" AND "CLOSED" MEAN for a warehouse's receiving hours (a-warehouse-with-no-hours-is-not-closed).

/**
 * Whether a warehouse's receiving hours are SET: a grid that opens on at least one day. No profile, an empty grid or a
 * week closed every day is NOT set — a week closed every day is not a schedule anyone means. The server answers the
 * same in `WarehouseReceivingState.hours_set` (warehouse_v1/receiving.go, `hoursSet`); this reads it off the profile a
 * Settings page already holds, so the *set your hours* prompt asks for nothing more.
 */
export function hoursAreSet(receivingHours: DayHours[] | undefined): boolean {
  return (receivingHours ?? []).some((day) => day.open);
}

/**
 * Whether the closed-day warning speaks for a receiving answer: a CLOSURE (a holiday) always — set hours or not — and
 * otherwise only a warehouse whose hours ARE set and that is not receiving now. Hours not set is not closed: no
 * warning on the order form, no badge in the picker.
 */
export function warehouseIsClosed(state: WarehouseReceivingState): boolean {
  if (state.closureReason !== "") {
    return true;
  }

  return state.hoursSet && !state.receivingNow;
}
