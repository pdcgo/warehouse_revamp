import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { suppliers } from "../../.storybook/fixtures";
import { SupplierSelect, description } from "./SupplierSelect";

const meta = {
  title: "Components/SupplierSelect",
  component: SupplierSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { teamId: 11n, onChange: fn() },
} satisfies Meta<typeof SupplierSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Selected: Story = { args: { value: suppliers[0]!.id } };

export const Disabled: Story = { args: { value: suppliers[0]!.id, disabled: true } };

// The whole list is loaded rather than searched server-side, and that is deliberate: a server-side
// search starts empty by design, so a supplier already selected on an edit form would not be in the
// collection to resolve into display text.
export const OpensOnClickWithTheWholeList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));

    for (const supplier of suppliers) {
      const option = await screen.findByTestId(`supplier-select-option-${supplier.id}`);
      await waitFor(() => expect(option).toBeVisible());
    }
  },
};

// Matches on name OR code — the combobox's default matcher only sees the label, so this is a custom
// filter and worth pinning.
export const SearchesByNameOrCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, suppliers[1]!.code);

    await expect(await screen.findByTestId(`supplier-select-option-${suppliers[1]!.id}`)).toBeVisible();
    await expect(screen.queryByTestId(`supplier-select-option-${suppliers[0]!.id}`)).toBeNull();
  },
};

// ⚠ CLEARING EMITS 0n — it does not do nothing (#131).
//
// "No supplier" is a legitimate value: a restock need not name one. Swallowing the empty case is
// what made this picker's predecessor WRITE-ONCE — a supplier recorded by mistake could never be
// removed, though the contract, the handler and its test all supported clearing it.
export const ClearingEmitsZero: Story = {
  args: { value: suppliers[0]!.id },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    const clear = await canvas.findByRole("button", { name: /clear/i });
    await userEvent.click(clear);

    await expect(args.onChange).toHaveBeenCalledWith(0n);
  },
};

// The #131 regression, guarded: an edit form mounts this with a supplier ALREADY set while the list
// is still in flight. Zag derives the input's display text when the machine initialises, so a
// collection that fills in later never re-derives it — the field would read blank while a supplier
// is in fact selected. The component re-keys on load for exactly this.
export const PrefilledValueShowsItsName: Story = {
  args: { value: suppliers[1]!.id },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByDisplayValue(new RegExp(suppliers[1]!.name))).toBeInTheDocument();
  },
};

// ⚠ FINDING — picking a supplier LEAVES THE FIELD BLANK, and this story is where it shows.
//
// The selection itself is correct: `onChange` fires with the right id, which is what the readout
// below asserts. What breaks is the DISPLAY TEXT, and the cause is a mismatch between two props:
//
//   itemToString → `${name} (${code})`      e.g. "PT Sumber Makmur (SUP-A)"
//   filter       → name.includes(q) || code.includes(q)
//
// On selection the combobox writes itemToString back into the input, which re-runs the filter with
// the WHOLE label as the query. No supplier's name contains "PT Sumber Makmur (SUP-A)" and no code
// does either, so the collection empties and the selected id no longer resolves to a label.
//
// That is the same class of bug as #131, which this component's own comments are largely about — a
// field that reads blank while a supplier is in fact selected. TeamSelect escapes it only by
// accident: its itemToString is the bare name, which its filter does match.
//
// The story asserts what is TRUE today rather than encoding the bug as correct. A fix belongs in the
// component (make the filter accept its own label, or make itemToString the bare name), and is the
// owner's call — see the note in the summary.
export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState(0n);

    return (
      <>
        <SupplierSelect {...args} value={value} onChange={setValue} />
        <p data-testid="picked">{value.toString()}</p>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));
    const option = await screen.findByTestId(`supplier-select-option-${suppliers[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    // The value round-trips correctly …
    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent(suppliers[0]!.id.toString()));
    // … while the input that should be showing its name is empty. Change this assertion when the
    // component is fixed — it is a tripwire, not an endorsement.
    await expect(canvas.getByRole("combobox")).toHaveValue("");
  },
};
