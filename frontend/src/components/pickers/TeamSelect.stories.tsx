import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { teams } from "../../../.storybook/fixtures";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamSelect, description } from "./TeamSelect";

const meta = {
  title: "Components/Pickers/TeamSelect",
  component: TeamSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { onChange: fn() },
} satisfies Meta<typeof TeamSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WarehousesOnly: Story = {
  args: { teamType: TeamType.WAREHOUSE },
};

export const Disabled: Story = {
  args: { disabled: true },
};

// ⚠ The listbox is PORTALLED, so it lands on document.body rather than inside the story canvas —
// hence `screen` and not `within(canvasElement)`. RackSelect is the deliberate opposite (it renders
// inline so it survives inside a modal), and getting the two mixed up is the most likely way one of
// these tests breaks for a reason that has nothing to do with the component.
export const OpensOnClickWithoutTyping: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));

    // openOnClick: the teams are already loaded, so making somebody type before they can see what
    // exists would be asking them to guess.
    //
    // `waitFor` around the VISIBILITY check, not just `findBy`: the option is in the DOM as soon as
    // the collection fills, but the popover animates in, so it is briefly present-and-invisible.
    // Asserting presence alone would pass on a picker whose listbox never actually opened.
    const option = await screen.findByTestId(`team-select-option-${teams[0]!.teamCode}`);
    await waitFor(() => expect(option).toBeVisible());
  },
};

// Searching matches the team CODE as well as the name — the combobox's default matcher only ever
// sees the name, so this is a custom filter and worth pinning.
export const SearchesByTeamCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, teams[1]!.teamCode);

    await expect(await screen.findByTestId(`team-select-option-${teams[1]!.teamCode}`)).toBeVisible();
    await expect(screen.queryByTestId(`team-select-option-${teams[0]!.teamCode}`)).toBeNull();
  },
};

export const EmitsTheTeamId: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));
    await userEvent.click(await screen.findByTestId(`team-select-option-${teams[1]!.teamCode}`));

    await expect(args.onChange).toHaveBeenCalledWith(teams[1]!.id);
  },
};

// The regression #131 was about, and the one caching nearly reintroduced: a form that PREFILLS a
// team mounts with `value` already set while the team list is still in flight. Zag derives the
// input's display text when the machine initialises, so a collection that fills in later leaves a
// blank REQUIRED field unless the component re-keys. This story is that bug's tripwire.
export const PrefilledValueShowsItsName: Story = {
  args: { value: teams[2]!.id },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByDisplayValue(teams[2]!.name)).toBeInTheDocument();
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<bigint | undefined>(undefined);

    return <TeamSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));
    await userEvent.click(await screen.findByTestId(`team-select-option-${teams[0]!.teamCode}`));

    await expect(canvas.getByRole("combobox")).toHaveValue(teams[0]!.name);
  },
};
