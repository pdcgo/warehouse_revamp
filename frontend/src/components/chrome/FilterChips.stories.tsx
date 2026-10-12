import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { FilterChips, description } from "./FilterChips";

// A filter as a row of chips — All first, one chosen at a time, in the main tone.

const OPTIONS = [
  { value: "shopee", label: "Shopee" },
  { value: "tokopedia", label: "Tokopedia" },
  { value: "lazada", label: "Lazada" },
  { value: "other", label: "Other" },
];

// Real state, so a click moves the choice.
function Controlled({ scroll }: { scroll?: boolean }) {
  const [value, setValue] = useState("");

  return (
    <>
      <FilterChips value={value} onChange={setValue} all="" allLabel="All" options={OPTIONS} ariaLabel="Store type" scroll={scroll} />
      <output data-testid="picked">{value || "all"}</output>
    </>
  );
}

const meta = {
  title: "Components/Chrome/FilterChips",
  component: Controlled,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// On a phone: one row that scrolls sideways.
export const Scrolling: Story = { args: { scroll: true }, globals: { viewport: { value: "mobile2" } } };

// ALL STARTS CHOSEN; a click chooses another, and only one is ever pressed.
export const OneChipIsChosen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("filter-chips-")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByTestId("filter-chips-tokopedia"));

    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent("tokopedia"));
    await expect(canvas.getByTestId("filter-chips-tokopedia")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getAllByRole("button", { pressed: true })).toHaveLength(1);

    // All puts it back.
    await userEvent.click(canvas.getByTestId("filter-chips-"));
    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent("all"));
  },
};
