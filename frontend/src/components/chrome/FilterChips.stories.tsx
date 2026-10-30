import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Lock, LockOpen } from "lucide-react";

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

// NO ALL CHIP — a set always narrowed to one of its options: the options alone, one always pressed.
function WithoutAllControlled() {
  const [value, setValue] = useState("shopee");

  return (
    <>
      <FilterChips value={value} onChange={setValue} options={OPTIONS} ariaLabel="Store type" />
      <output data-testid="picked">{value}</output>
    </>
  );
}

export const WithoutAll: Story = {
  render: () => <WithoutAllControlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("filter-chips-")).toBeNull();
    await expect(canvas.getAllByRole("button")).toHaveLength(OPTIONS.length);
    await expect(canvas.getByTestId("filter-chips-shopee")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(canvas.getByTestId("filter-chips-lazada"));
    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent("lazada"));
    await expect(canvas.getAllByRole("button", { pressed: true })).toHaveLength(1);
  },
};

// AN OPTION MAY CARRY ITS ICON — the one the same thing carries elsewhere (Discover's division and lock, as on its cards).
function WithIconsControlled() {
  const [value, setValue] = useState("");

  return (
    <FilterChips
      value={value}
      onChange={setValue}
      all=""
      allLabel="All"
      options={[
        { value: "open", label: "Open", icon: LockOpen },
        { value: "locked", label: "Locked", icon: Lock },
      ]}
      ariaLabel="Lock"
    />
  );
}

export const WithIcons: Story = {
  render: () => <WithIconsControlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Each option's icon before its label; All has none.
    await expect(canvas.getByTestId("filter-chips-open").querySelector("svg")).not.toBeNull();
    await expect(canvas.getByTestId("filter-chips-locked").querySelector("svg")).not.toBeNull();
    await expect(canvas.getByTestId("filter-chips-").querySelector("svg")).toBeNull();
  },
};
