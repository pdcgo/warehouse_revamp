import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { users } from "../../../.storybook/fixtures";
import { UserSelect, description } from "./UserSelect";

const meta = {
  title: "Components/Pickers/UserSelect",
  component: UserSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { onChange: fn() },
} satisfies Meta<typeof UserSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchesEveryone: Story = {};

// With a teamId the search narrows to that team's members (UserList) instead of everyone
// (SearchUser). The backend enforces the difference too — UserList is role-gated and scoped, while
// SearchUser is open to any authenticated caller — so this is not merely a client-side filter.
export const ScopedToATeam: Story = { args: { teamId: 11n } };

export const Disabled: Story = { args: { disabled: true } };

// `flush` drops the picker's own border so it can sit inside a bordered group — fused to a role
// segment, the way DateRangePicker fuses its field segment to its trigger. The FOCUS RING stays: it
// is the only thing that says which half of a fused control has the keyboard.
export const FlushInsideAGroup: Story = {
  render: (args) => (
    <Box borderWidth="1px" borderColor="border" borderRadius="l2" overflow="hidden" w="80">
      <UserSelect {...args} flush />
    </Box>
  ),
};

// ⚠ The search does not fire below TWO characters — both backends want it (SearchUser rejects
// fewer), so the component does not ask at all. The empty state says so rather than claiming
// "no users found", which would be a different and wrong answer to the question asked.
export const BelowTwoCharactersItDoesNotSearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "a");

    await expect(await screen.findByText("Type at least 2 characters")).toBeInTheDocument();
  },
};

export const SearchesServerSide: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "bud");

    const option = await screen.findByTestId(`user-select-option-${users[1]!.username}`);
    await waitFor(() => expect(option).toBeVisible());

    // Options render with the shared UserItem, so a person is shown the same way here as in a list.
    await expect(option).toHaveTextContent(users[1]!.name);
    await expect(option).toHaveTextContent(`@${users[1]!.username}`);
  },
};

export const EmitsTheUserId: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "ani");

    const option = await screen.findByTestId(`user-select-option-${users[0]!.username}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith(users[0]!.id);
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<bigint | undefined>(undefined);

    return <UserSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "citra");

    const option = await screen.findByTestId(`user-select-option-${users[2]!.username}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(input).toHaveValue(users[2]!.username));
  },
};
