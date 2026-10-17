import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { RadioPills, description } from "./RadioPills";

type Direction = "in" | "out";

function Harness() {
  const [value, setValue] = useState<Direction>("in");

  return (
    <RadioPills
      value={value}
      onChange={setValue}
      ariaLabel="Direction"
      testId="pills"
      options={[
        { value: "in", label: "Add capital", testId: "pill-in" },
        { value: "out", label: "Withdraw capital", testId: "pill-out" },
      ]}
    />
  );
}

const meta = {
  title: "Components/Inputs/RadioPills",
  component: Harness,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A radio: one checked, a click moves it, and the chosen pill is drawn in the main tone (rose). */
export const OneChoiceInTheMainTone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [inRadio, outRadio] = canvas.getAllByRole("radio");

    await expect(inRadio).toBeChecked();
    await userEvent.click(canvas.getByTestId("pill-out"));
    await waitFor(() => expect(outRadio).toBeChecked());
    await expect(inRadio).not.toBeChecked();
    await expect(getComputedStyle(canvas.getByTestId("pill-out")).borderColor).toBe("rgb(225, 29, 72)");
  },
};
