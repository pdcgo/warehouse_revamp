import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { SupplierSearchSelect, description } from "./SupplierSearchSelect";

// Searched as Gudang Pusat (11), a warehouse — it keeps no suppliers of its own (only-a-selling-team-has-suppliers), so
// it meets every team's: PT Sumber Makmur (31) is Toko Melati's.
const meta = {
  title: "Components/Pickers/SupplierSearchSelect",
  component: SupplierSearchSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { teamId: 11n, onChange: fn() },
} satisfies Meta<typeof SupplierSearchSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

// It withholds its list until two characters are typed — every team's suppliers are too many to show whole.
export const BelowTwoCharactersItDoesNotSearch: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "s");

    await expect(await screen.findByText("Type at least 2 characters")).toBeInTheDocument();
  },
};

// Another team's supplier is found by its name, the option naming the team that keeps it, and a pick emits it whole.
export const FindsEveryTeamsSupplierWithItsTeam: Story = {
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "sumber", { delay: 30 });

    const option = await screen.findByTestId("supplier-search-select-option-31", {}, { timeout: 4000 });
    await waitFor(() => expect(option).toHaveTextContent("PT Sumber Makmur"));
    await expect(option).toHaveTextContent("Toko Melati");
    await waitFor(() => expect(option).toBeVisible());

    await userEvent.click(option);
    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 31n, name: "PT Sumber Makmur" })));
  },
};

export const NothingMatches: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "zzzz", { delay: 30 });

    await expect(await screen.findByText("No suppliers found", {}, { timeout: 4000 })).toBeInTheDocument();
  },
};
