import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { toRupiah } from "./counting";
import { CourierCharge } from "./CourierCharge";

// THE COURIER'S CHARGE AT THE DOOR — one amount and its note, drawn by the Tandai Tiba dialog and the Terima page alike
// (the-cod-can-be-noted-when-the-box-arrives). The harness holds the real state, so typing is tested, not a constant.
function Harness({ hint }: { hint?: string }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const charged = toRupiah(amount) > 0;

  return (
    <CourierCharge
      amount={amount}
      note={note}
      charged={charged}
      noteMissing={charged && note.trim() === ""}
      onAmount={setAmount}
      onNote={setNote}
      hint={hint}
    />
  );
}

const meta = {
  title: "Features/Restock/CourierCharge",
  component: Harness,
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At Terima — final. */
export const AtAccept: Story = {};

/** At Tandai Tiba — optional, and still open to change at Terima. */
export const AtArrival: Story = {
  args: { hint: "If the courier asked for something when handing the box over. Optional — it can still be entered or changed at Accept." },
};

// THE NOTE IS REQUIRED ONCE THERE IS AN AMOUNT — said the moment the amount is typed, gone once the note is written.
export const ANoteIsRequiredOnceThereIsAnAmount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("accept-courier-note-error")).toBeNull();

    await userEvent.type(canvas.getByTestId("accept-courier-charge"), "5000", { delay: 20 });
    await expect(await canvas.findByTestId("accept-courier-note-error")).toBeVisible();

    await userEvent.type(canvas.getByTestId("accept-courier-note"), "Biaya COD", { delay: 20 });
    await waitFor(() => expect(canvas.queryByTestId("accept-courier-note-error")).toBeNull());
  },
};
