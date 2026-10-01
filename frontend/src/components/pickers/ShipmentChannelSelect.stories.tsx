import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { shipmentChannels } from "../../../.storybook/fixtures";
import { ShipmentChannelSelect, description } from "./ShipmentChannelSelect";

const [jne, jnt, , pos] = shipmentChannels;

const meta = {
  title: "Components/Pickers/ShipmentChannelSelect",
  component: ShipmentChannelSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: 0n, onChange: fn() },
} satisfies Meta<typeof ShipmentChannelSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoChannel: Story = {};

export const Selected: Story = { args: { value: jne!.id } };

export const Disabled: Story = { args: { value: jne!.id, disabled: true } };

// A pre-set id shows its NAME once the options land — the remount rule inherited from ShippingSelect.
export const APresetIdShowsItsName: Story = {
  args: { value: jne!.id },
  play: async ({ canvasElement }) => {
    // Re-query inside waitFor: the root REMOUNTS when the options land, so an input grabbed before that
    // is a detached node that will never show the name.
    await waitFor(() => expect(within(canvasElement).getByRole("combobox")).toHaveValue(jne!.name));
  },
};

// a-deleted-channel-still-resolves-by-id: the picker is for NEW work, so a deleted courier is not offered.
export const DeletedChannelsAreNotOffered: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("combobox"));

    await waitFor(() => expect(screen.getByTestId(`shipment-channel-option-${jne!.code}`)).toBeVisible());
    await expect(screen.queryByTestId(`shipment-channel-option-${pos!.code}`)).toBeNull();
  },
};

// shipment-channel-is-an-id-into-shipment-service: it emits the ID, never the code or the name.
export const EmitsTheChannelId: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("combobox"));

    const option = await screen.findByTestId(`shipment-channel-option-${jnt!.code}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith(jnt!.id);
  },
};

// Matches on code as well as name — people type "jnt" as often as "J&T".
export const MatchesOnCode: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "sicep", { delay: 40 });

    await waitFor(() => expect(screen.getByTestId("shipment-channel-option-sicepat")).toBeVisible());
    await expect(screen.queryByTestId(`shipment-channel-option-${jne!.code}`)).toBeNull();
  },
};

// A search matching NOTHING must not reset the field — the remount is keyed on seeding, not on how many
// options are showing.
export const ANoMatchSearchKeepsTheTyping: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox"));
    await waitFor(() => expect(screen.getByTestId(`shipment-channel-option-${jne!.code}`)).toBeVisible());

    await userEvent.type(canvas.getByRole("combobox"), "zzz", { delay: 40 });

    await waitFor(() => expect(canvas.getByRole("combobox")).toHaveValue("zzz"));
  },
};
