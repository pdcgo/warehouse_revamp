import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { RoleSelect, description } from "./RoleSelect";

const meta = {
  title: "Components/RoleSelect",
  component: RoleSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { onChange: fn() },
} satisfies Meta<typeof RoleSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllRoles: Story = {};

export const ForAWarehouseTeam: Story = { args: { teamType: TeamType.WAREHOUSE } };

export const ForASellingTeam: Story = { args: { teamType: TeamType.SELLING } };

export const Selected: Story = { args: { value: Role.WAREHOUSE_ADMIN } };

export const Disabled: Story = { args: { value: Role.TEAM_OWNER, disabled: true } };

// ROOT and ADMIN are only meaningful in the root team — the backend refuses to grant them anywhere
// else — so a warehouse-team picker that offered them would just be a button that always errors.
export const TeamTypeNarrowsTheOfferedRoles: Story = {
  args: { teamType: TeamType.WAREHOUSE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));

    await expect(await screen.findByTestId(`role-select-option-${Role.WAREHOUSE_STAFF}`)).toBeInTheDocument();
    await expect(screen.queryByTestId(`role-select-option-${Role.ROOT}`)).toBeNull();
  },
};

// Precedence is explicit `roles` → `teamType` → all. An explicit list wins outright, which is what
// lets a caller offer something the team-type default would not.
export const ExplicitRolesWinOverTeamType: Story = {
  args: { teamType: TeamType.WAREHOUSE, roles: [Role.ROOT, Role.ADMIN] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));

    await expect(await screen.findByTestId(`role-select-option-${Role.ROOT}`)).toBeInTheDocument();
    await expect(screen.queryByTestId(`role-select-option-${Role.WAREHOUSE_STAFF}`)).toBeNull();
  },
};

// SYSTEM is an internal role and UNSPECIFIED is the absence of one — neither is assignable, so
// neither appears even in the "all" list.
export const NeitherSystemNorUnspecifiedIsOffered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));

    await expect(await screen.findByTestId(`role-select-option-${Role.ROOT}`)).toBeInTheDocument();
    await expect(screen.queryByTestId(`role-select-option-${Role.SYSTEM}`)).toBeNull();
    await expect(screen.queryByTestId(`role-select-option-${Role.UNSPECIFIED}`)).toBeNull();
  },
};

export const SearchesByLabel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "warehouse");

    await expect(await screen.findByTestId(`role-select-option-${Role.WAREHOUSE_OWNER}`)).toBeInTheDocument();
    await expect(screen.queryByTestId(`role-select-option-${Role.TEAM_OWNER}`)).toBeNull();
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<Role | undefined>(undefined);

    return <RoleSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // ⚠ RoleSelect does NOT set `openOnClick`, unlike TeamSelect — clicking the input alone leaves
    // the listbox closed, so the options stay in the DOM but invisible and unclickable. Typing is
    // what opens it. (That inconsistency between two sibling pickers is real, and this is where it
    // is visible.)
    const input = canvas.getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "Team Admin");

    // Then wait for VISIBILITY, not just presence: while the popover animates in the options carry
    // `pointer-events: none` and a click is rejected outright.
    const option = await screen.findByTestId(`role-select-option-${Role.TEAM_ADMIN}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(input).toHaveValue("Team Admin"));
  },
};
