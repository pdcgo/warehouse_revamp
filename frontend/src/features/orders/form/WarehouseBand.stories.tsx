import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { WarehouseBand } from "./WarehouseBand";

// THE CLOSED-DAY WARNING (a-closed-day-warns-and-never-refuses, a-warehouse-records-its-holidays) — the band names when
// a closed warehouse will handle the order, and the picker MARKS a closed one, still selectable. A warning, never a
// refusal: nothing here stops the order. In the stub, Gudang Pusat (11) receives now and Gudang Cabang (14) is closed
// for Idul Fitri.

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
    await expect(await canvas.findByTestId("order-warehouse-band")).toBeVisible();
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
