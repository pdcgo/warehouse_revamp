import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";

import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { CREATABLE_TEAM_TYPES, TeamTypeSelect, description, teamTypeLabel } from "./TeamTypeSelect";

const meta = {
  title: "Components/TeamTypeSelect",
  component: TeamTypeSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { onChange: fn() },
} satisfies Meta<typeof TeamTypeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Selected: Story = { args: { value: TeamType.WAREHOUSE } };

export const Disabled: Story = { args: { value: TeamType.SELLING, disabled: true } };

// A caller that also has to offer ROOT (a filter, rather than a create form) passes its own list.
export const EveryTypeIncludingRoot: Story = {
  args: { types: [TeamType.ROOT, ...CREATABLE_TEAM_TYPES] },
};

// ROOT is excluded from the DEFAULT set because the root team is seeded, never created. Offering it
// on a create form would be offering an action the backend refuses.
export const RootIsNotOfferedByDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("team-type-select"));

    // ⚠ Query by ROLE, not by text. `Select.HiddenSelect` renders a real <select> carrying a native
    // <option> for every item, so `getByText("Warehouse")` matches twice and fails for a reason that
    // has nothing to do with the picker. The hidden select is aria-hidden, so the accessibility tree
    // — which is what getByRole walks — contains only the visible listbox.
    await expect(await screen.findByRole("option", { name: teamTypeLabel(TeamType.WAREHOUSE) })).toBeInTheDocument();
    await expect(screen.queryByRole("option", { name: teamTypeLabel(TeamType.ROOT) })).toBeNull();
  },
};

// It emits the ENUM, not a string, so callers never coerce at the call site.
export const EmitsTheEnum: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("team-type-select"));
    await userEvent.click(await screen.findByRole("option", { name: teamTypeLabel(TeamType.SELLING) }));

    await expect(args.onChange).toHaveBeenCalledWith(TeamType.SELLING);
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<TeamType | undefined>(undefined);

    return <TeamTypeSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("team-type-select"));
    await userEvent.click(await screen.findByRole("option", { name: teamTypeLabel(TeamType.ADMIN) }));

    await expect(canvas.getByTestId("team-type-select")).toHaveTextContent("Admin");
  },
};
