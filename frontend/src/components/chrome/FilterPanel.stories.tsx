import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Checkbox, Input } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { FilterGroup, FilterPanel, description } from "./FilterPanel";

// A list's filters as a column beside it — titled, sticky, one labelled group per filter, Hapus Filter only while one
// is set.

// Real state, so ticking a box narrows and Hapus Filter takes it back.
function Controlled() {
  const [inStock, setInStock] = useState(false);
  const [city, setCity] = useState("");

  return (
    <Box w="16rem">
      <FilterPanel
        active={inStock || city !== ""}
        onClear={() => {
          setInStock(false);
          setCity("");
        }}
      >
        <FilterGroup label="City" testId="group-city">
          <Input value={city} placeholder="Example: Bandung" onChange={(e) => setCity(e.target.value)} />
        </FilterGroup>
        <FilterGroup label="Stock" testId="group-stock">
          <Checkbox.Root checked={inStock} onCheckedChange={(e) => setInStock(!!e.checked)} data-testid="in-stock">
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Only those with stock</Checkbox.Label>
          </Checkbox.Root>
        </FilterGroup>
      </FilterPanel>
    </Box>
  );
}

const meta = {
  title: "Components/Chrome/FilterPanel",
  component: Controlled,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// THE GROUPS STAND IN THE CALLER'S ORDER, each under its label — the label in the field label's type.
export const GroupsInReadingOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const groups = canvas.getAllByTestId(/^group-/).map((el) => el.dataset.testid);

    await expect(groups).toEqual(["group-city", "group-stock"]);
    await expect(within(canvas.getByTestId("group-city")).getByText("City")).toBeVisible();
  },
};

// HAPUS FILTER EXISTS ONLY WHILE FILTERING (clear-filters-is-red-and-bold) — it arrives with the first pick and takes
// every filter back.
export const ClearOnlyWhileFiltering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("filter-panel-clear")).toBeNull();
    await expect(canvas.getByTestId("filter-panel")).not.toHaveAttribute("data-filtering");

    await userEvent.click(within(canvas.getByTestId("in-stock")).getByRole("checkbox"));
    await expect(canvas.getByTestId("filter-panel")).toHaveAttribute("data-filtering", "true");

    await userEvent.click(await canvas.findByTestId("filter-panel-clear"));
    await waitFor(() => expect(canvas.queryByTestId("filter-panel-clear")).toBeNull());
    await expect(within(canvas.getByTestId("in-stock")).getByRole("checkbox")).not.toBeChecked();
  },
};

// Many groups — more than a window holds.
function Tall() {
  return (
    <Box w="16rem">
      <FilterPanel>
        {Array.from({ length: 14 }, (_, i) => (
          <FilterGroup key={i} label={`Group ${i + 1}`} testId={`tall-group-${i}`}>
            <Input placeholder="Example: Bandung" />
          </FilterGroup>
        ))}
      </FilterPanel>
    </Box>
  );
}

// NEVER PAST THE WINDOW'S FOOT (owner: *"filternya tenggelam di bawah, kudu scroll produk"*) — a panel with more groups
// than the window holds ends above its bottom, and its groups scroll inside it; the last one is reached without the
// window moving.
export const NeverPastTheWindowsFoot: Story = {
  render: () => <Tall />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvas.getByTestId("filter-panel");
    const groups = canvas.getByTestId("filter-panel-groups");

    await waitFor(() => expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight));
    await expect(groups.scrollHeight).toBeGreaterThan(groups.clientHeight);

    groups.scrollTop = groups.scrollHeight;
    await waitFor(() => expect(canvas.getByTestId("tall-group-13").getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight));
  },
};
