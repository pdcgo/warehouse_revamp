import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { toRupiah } from "./counting";
import { CourierCharge } from "./CourierCharge";

// THE COURIER'S CHARGE AT THE DOOR — one amount and its note, drawn by the Tandai Tiba dialog and the Terima page alike
// (the-cod-can-be-noted-when-the-box-arrives), ASKED FIRST (the-charge-is-asked-for-before-it-is-filled). The harness holds
// the real state, so typing is tested, not a constant.
function Harness({ hint, startAsked = false }: { hint?: string; startAsked?: boolean }) {
  const [asked, setAsked] = useState(startAsked);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const charged = asked && toRupiah(amount) > 0;

  return (
    <CourierCharge
      asked={asked}
      onAsked={setAsked}
      amount={amount}
      note={note}
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

/** At Terima, not asked yet — two pills and nothing else. */
export const AtAccept: Story = {};

/** At Tandai Tiba — the hint says it can still be entered or changed at Terima. */
export const AtArrival: Story = {
  args: { hint: "If the courier asked for a charge when handing the box over — it can still be entered or changed at Accept." },
};

/** On Ada: the amount and the note, both required. */
export const Asked: Story = { args: { startAsked: true } };

// ASKED FIRST, THEN FILLED (owner: *"default formnya ongkir dsb itu disabled, baru enabled saat interaksi tertentu"*) — no
// fields on Tidak ada, the default; on Ada, the amount and the note appear, the note a textarea with its count; its error shows once
// there is an amount, and goes once it is written. Back to Tidak ada, the fields go.
export const TheChargeIsAskedFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("accept-courier-charge")).toBeNull();
    await expect(canvas.getByTestId("accept-courier-asked-none")).toHaveAttribute("data-state", "checked");
    await userEvent.click(canvas.getByTestId("accept-courier-asked-yes"));

    const note = await canvas.findByTestId("accept-courier-note");
    await expect(note.tagName).toBe("TEXTAREA");
    await expect(canvas.getByTestId("accept-courier-note-count")).toHaveTextContent("0/200");
    await expect(canvas.queryByTestId("accept-courier-note-error")).toBeNull();

    await userEvent.type(canvas.getByTestId("accept-courier-charge"), "5000", { delay: 20 });
    await expect(await canvas.findByTestId("accept-courier-note-error")).toBeVisible();

    await userEvent.type(note, "Biaya COD", { delay: 20 });
    await waitFor(() => expect(canvas.queryByTestId("accept-courier-note-error")).toBeNull());

    await userEvent.click(canvas.getByTestId("accept-courier-asked-none"));
    await waitFor(() => expect(canvas.queryByTestId("accept-courier-charge")).toBeNull());
  },
};
