import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { expect, fn, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { CABANG_REOPENS } from "../../../../.storybook/warehouseInfoStub";
import { warehouseInfoClient } from "../../../api/clients";
import { WarehouseReceivingStatusResponseSchema } from "../../../gen/warehouse/warehouse/v1/warehouse_info_pb";
import { WarehouseBand } from "./WarehouseBand";

// THE CLOSED-DAY WARNING (a-closed-day-warns-and-never-refuses, a-warehouse-records-its-holidays) — the band names when
// a closed warehouse will handle the order, and the picker MARKS a closed one, still selectable. A warning, never a
// refusal: nothing here stops the order. In the stub, Gudang Pusat (11) receives now and Gudang Cabang (14) is closed
// for Idul Fitri — both with their hours set.
//
// A warehouse whose receiving hours are NOT SET is not closed (a-warehouse-with-no-hours-is-not-closed): no sentence,
// no badge — only a closure still warns for it. Those stories answer WarehouseReceivingStatus through a spy.

interface ReceivingAnswer {
  receivingNow: boolean;
  nextOpeningUnix: bigint;
  closureReason: string;
  hoursSet: boolean;
}

/** What a warehouse with no receiving hours set answers: not receiving, nothing next — and `hoursSet` false. */
const NO_HOURS: ReceivingAnswer = { receivingNow: false, nextOpeningUnix: 0n, closureReason: "", hoursSet: false };

/** A `beforeEach`: WarehouseReceivingStatus answers `states` by warehouse id, and NO_HOURS for every other asked id. */
function receivingAnswers(states: Record<string, ReceivingAnswer>) {
  return () => {
    const spy = spyOn(warehouseInfoClient, "warehouseReceivingStatus").mockImplementation(async (req) =>
      create(WarehouseReceivingStatusResponseSchema, {
        states: Object.fromEntries(
          (req.warehouseIds ?? []).map((id) => [id.toString(), { warehouseId: id, ...(states[id.toString()] ?? NO_HOURS) }]),
        ),
      }),
    );

    return () => spy.mockRestore();
  };
}

/** Every warehouse id WarehouseReceivingStatus was asked about so far (spied). */
function askedIds(): string[] {
  const spied = warehouseInfoClient.warehouseReceivingStatus as unknown as {
    mock: { calls: [{ warehouseIds?: bigint[] }][] };
  };
  return spied.mock.calls.flatMap(([req]) => (req.warehouseIds ?? []).map((id) => id.toString()));
}

/** The picker opened, its two warehouses listed and each one's receiving state asked — and answered. */
async function pickerOpenAndAsked(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(within(await canvas.findByTestId("order-warehouse")).getByRole("combobox"));
  await waitFor(() => expect(screen.getByTestId("team-select-option-WH-01")).toBeVisible(), { timeout: 5000 });
  await waitFor(() => expect(screen.getByTestId("team-select-option-WH-02")).toBeVisible(), { timeout: 5000 });
  await waitFor(() => expect(askedIds()).toEqual(expect.arrayContaining(["11", "14"])), { timeout: 5000 });
  // The spied answers resolve on the next tick; give them a beat to be drawn before judging what is NOT there.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const meta = {
  title: "Features/Orders/WarehouseBand",
  component: WarehouseBand,
  args: { value: 11n, onChange: fn() },
} satisfies Meta<typeof WarehouseBand>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An open warehouse says nothing about the hours. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("order-warehouse-band")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.queryByTestId("warehouse-closed-note")).toBeNull();
  },
};

/** A closed warehouse: the band says why and from when — and the order can still be recorded. */
export const ClosedForAHoliday: Story = {
  args: { value: 14n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const note = await canvas.findByTestId("warehouse-closed-note");
    await expect(note).toHaveTextContent("Closed for Idul Fitri");
    await expect(note).toHaveTextContent("08:00 WIB");
    await expect(note).toHaveTextContent("still recorded");
  },
};

/** The picker marks the closed warehouse — and it is still an option. */
export const ThePickerMarksTheClosedOne: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(await canvas.findByTestId("order-warehouse")).getByRole("combobox"));
    const badge = await screen.findByTestId("warehouse-closed-badge-14");
    await waitFor(() => expect(badge).toBeVisible());
    await expect(screen.queryByTestId("warehouse-closed-badge-11")).toBeNull();
  },
};

// ── a-warehouse-with-no-hours-is-not-closed ─────────────────────────────────────────────────────

/** NO HOURS SET IS NOT CLOSED — neither warehouse has set its receiving hours: no sentence under the band, no badge. */
export const NoHoursSetIsNotClosed: Story = {
  name: "No hours set is not closed — no warning, no badge",
  beforeEach: receivingAnswers({}),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("order-warehouse-band")).toBeVisible(), { timeout: 5000 });
    await waitFor(() => expect(askedIds()).toContain("11"), { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(canvas.queryByTestId("warehouse-closed-note")).toBeNull();

    await pickerOpenAndAsked(canvasElement);
    await expect(screen.queryByTestId("warehouse-closed-badge-11")).toBeNull();
    await expect(screen.queryByTestId("warehouse-closed-badge-14")).toBeNull();
  },
};

/** A CLOSURE STILL WARNS with no hours set — closed for its reason, with no opening to name (no grid to find one in). */
export const AClosureWarnsWithNoHoursSet: Story = {
  name: "A closure still warns a warehouse with no hours set",
  beforeEach: receivingAnswers({ "11": { ...NO_HOURS, closureReason: "Idul Fitri" } }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("warehouse-closed-note")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.getByTestId("warehouse-closed-note")).toHaveTextContent("Closed for Idul Fitri");
    await expect(canvas.getByTestId("warehouse-closed-note")).toHaveTextContent("handled when the warehouse opens");

    await pickerOpenAndAsked(canvasElement);
    await waitFor(() => expect(screen.getByTestId("warehouse-closed-badge-11")).toBeVisible());
    await expect(screen.queryByTestId("warehouse-closed-badge-14")).toBeNull();
  },
};

/** HOURS SET AND CLOSED NOW still warns, as before — the next opening named, the warehouse badged. */
export const HoursSetAndClosedNowWarns: Story = {
  name: "Hours set and closed now still warns, naming the next opening",
  beforeEach: receivingAnswers({
    "11": { receivingNow: false, nextOpeningUnix: CABANG_REOPENS, closureReason: "", hoursSet: true },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("warehouse-closed-note")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.getByTestId("warehouse-closed-note")).toHaveTextContent("Closed now");
    await expect(canvas.getByTestId("warehouse-closed-note")).toHaveTextContent("08:00 WIB");

    await pickerOpenAndAsked(canvasElement);
    await waitFor(() => expect(screen.getByTestId("warehouse-closed-badge-11")).toBeVisible());
  },
};
