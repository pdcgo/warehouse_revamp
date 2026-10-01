import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "@chakra-ui/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { CurrencyInput, description, formatDigits, toDigits } from "./CurrencyInput";

const meta = {
  title: "Components/Inputs/CurrencyInput",
  component: CurrencyInput,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    value: "",
    onChange: fn(),
    placeholder: "0",
    "aria-label": "Price",
  },
} satisfies Meta<typeof CurrencyInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithValue: Story = { args: { value: "20000" } };

export const Large: Story = { args: { value: "125000000" } };

export const InAField: Story = {
  render: (args) => {
    const [value, setValue] = useState("20000");

    return (
      <Field.Root w="64">
        <Field.Label>Harga (Rupiah)</Field.Label>
        <CurrencyInput {...args} value={value} onChange={setValue} />
        <Field.HelperText>Raw value: {value || "(empty)"}</Field.HelperText>
      </Field.Root>
    );
  },
};

// The contract: the CALLER holds raw digits and never sees a separator. `value` in and `onChange`
// out are both unformatted, which is what lets every existing `toRupiah(...)` parse keep working.
export const EmitsRawDigitsButDisplaysGrouped: Story = {
  args: { value: "20000" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    const input = canvas.getByLabelText("Price");
    await expect(input).toHaveValue("20.000");

    await userEvent.type(input, "0");

    // Grouped on screen, raw on the wire.
    await expect(args.onChange).toHaveBeenLastCalledWith("200000");
  },
};

// ⚠ THE BUG THIS COMPONENT EXISTS FOR (#166). Every money field starts at "0", so typing into a
// `type="number"` produced "020000" — and a person who types 20000 and sees 020000 stops trusting
// the field.
export const DropsLeadingZeros: Story = {
  args: { value: "0" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByLabelText("Price"), "5");

    await expect(args.onChange).toHaveBeenLastCalledWith("5");
  },
};

// A stray "-" or "e" is not a price, and `type="number"` would have silently accepted both.
//
// ⚠ This story is STATEFUL, and it has to be. The component is fully controlled, so a story that
// pins `value` to a constant re-renders the field back to that constant after every keystroke —
// typing "-1e5" would then report only the last character and the test would pass or fail on
// something that never happens in a real form.
export const RefusesAnythingThatIsNotADigit: Story = {
  render: (args) => {
    const [value, setValue] = useState("");

    return (
      <>
        <CurrencyInput {...args} value={value} onChange={setValue} />
        <span data-testid="raw">{value}</span>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByLabelText("Price"), "-1e5");

    // The minus and the "e" are gone; the digits survive in order.
    await expect(canvas.getByTestId("raw")).toHaveTextContent("15");
  },
};

// The pure helpers, pinned directly — the rounding rules are easier to read as a table than as a
// sequence of keystrokes, and these are exported precisely so callers can reuse them.
export const FormattingRules: Story = {
  render: () => (
    <table data-testid="rules">
      <thead>
        <tr>
          <th>raw</th>
          <th>toDigits</th>
          <th>formatDigits</th>
        </tr>
      </thead>
      <tbody>
        {["", "0", "000", "007", "20000", "-1e5", "1.234.567"].map((raw) => (
          <tr key={raw}>
            <td>{JSON.stringify(raw)}</td>
            <td>{JSON.stringify(toDigits(raw))}</td>
            <td>{JSON.stringify(formatDigits(toDigits(raw)))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
  play: async () => {
    // "" stays "" rather than becoming "0": an empty field is a person who has not typed yet, and
    // filling it with a zero on their behalf answers a question they were still thinking about.
    await expect(toDigits("")).toBe("");
    // …but an explicit zero IS a legitimate price (a sample, a transfer), so "000" collapses to "0".
    await expect(toDigits("000")).toBe("0");
    await expect(toDigits("007")).toBe("7");
    await expect(formatDigits("20000")).toBe("20.000");
  },
};
