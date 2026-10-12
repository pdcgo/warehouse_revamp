import { useState } from "react";

import { create } from "@bufbuild/protobuf";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { publicUsers } from "../../../.storybook/fixtures";
import { PublicUserSchema } from "../../gen/warehouse/user/v1/user_pb";
import { PersonFilterSelect, description } from "./PersonFilterSelect";

// The people a list's own service said are on its rows, latest first: Budi, Citra (suspended — a filter keeps
// her), Eko, and a former user whose account was erased.
const ani = publicUsers[0]!;
const budi = publicUsers[1]!;
const citra = publicUsers[2]!;
const eko = publicUsers[4]!;

const people = [
  create(PublicUserSchema, budi),
  create(PublicUserSchema, citra),
  create(PublicUserSchema, eko),
  create(PublicUserSchema, { id: 69n, username: "erased69", name: "", isSuspended: true }),
];

const meta = {
  title: "Components/Pickers/PersonFilterSelect",
  component: PersonFilterSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { people, onChange: fn(), placeholder: "Anyone who raised it" },
} satisfies Meta<typeof PersonFilterSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

async function open(canvasElement: HTMLElement) {
  const input = within(canvasElement).getByRole("combobox");
  await userEvent.click(input);

  return input;
}

export const OnTheRows: Story = {};

export const Loading: Story = { args: { people: undefined } };

// A list nobody has touched yet offers nobody, and says so.
export const Nobody: Story = {
  args: { people: [] },
  play: async ({ canvasElement }) => {
    await open(canvasElement);

    await expect(await screen.findByText("Nobody yet")).toBeInTheDocument();
  },
};

// The people could not be read: the field says so, rather than reading as a list with nobody on it.
export const Unavailable: Story = {
  args: { people: undefined, error: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("combobox")).toHaveAttribute("placeholder", "People unavailable");
  },
};

// a-filter-keeps-former-and-suspended-people: Citra is suspended and still offered, with a badge — last year's
// restocks are still hers. A former user reads as one, never by the synthetic username.
export const KeepsSuspendedAndFormerPeople: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);

    const suspended = await screen.findByTestId(`person-filter-option-${citra.id}`);
    await waitFor(() => expect(suspended).toBeVisible());
    await expect(suspended).toHaveTextContent(citra.name);
    await expect(screen.getByTestId(`person-filter-suspended-${citra.id}`)).toHaveTextContent("Suspended");

    // Budi is not suspended, so no badge.
    await expect(screen.queryByTestId(`person-filter-suspended-${budi.id}`)).toBeNull();

    const former = screen.getByTestId("person-filter-option-69");
    await expect(former).toHaveTextContent("Former user #69");
    await expect(former).not.toHaveTextContent("erased69");
  },
};

// Loaded whole, filtered in the field — on the name or the username.
export const FiltersAsYouType: Story = {
  play: async ({ canvasElement }) => {
    const input = await open(canvasElement);
    await userEvent.type(input, "eko", { delay: 40 });

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    await expect(screen.getByTestId(`person-filter-option-${eko.id}`)).toBeVisible();
  },
};

// Only the people on the rows: Ani raised nothing here, so she is not offered — the list is not a member list.
export const OnlyThePeopleOnTheRows: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(people.length));
    await expect(screen.queryByTestId(`person-filter-option-${ani.id}`)).toBeNull();
  },
};

export const EmitsTheUserId: Story = {
  play: async ({ args, canvasElement }) => {
    await open(canvasElement);

    const option = await screen.findByTestId(`person-filter-option-${budi.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith(budi.id);
  },
};

// A filter restored with a person already picked shows their name — the remount once the people land.
export const PrefilledShowsTheName: Story = {
  args: { value: eko.id },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByRole("combobox")).toHaveValue(eko.name));
  },
};

// ⚠ CLEARING EMITS `undefined` — "anybody", the filter removed (#131).
export const ClearingEmitsUndefined: Story = {
  args: { value: budi.id },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /clear/i }));

    await expect(args.onChange).toHaveBeenCalledWith(undefined);
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<bigint | undefined>(undefined);

    return <PersonFilterSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const input = await open(canvasElement);

    const option = await screen.findByTestId(`person-filter-option-${citra.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(input).toHaveValue(citra.name));
  },
};
