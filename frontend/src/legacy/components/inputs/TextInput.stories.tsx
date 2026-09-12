import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text } from "@chakra-ui/react";
import { expect, userEvent, within } from "storybook/test";

import { Field } from "./Field";
import { TextInput, Textarea, description, textareaDescription } from "./TextInput";

const meta = {
  title: "Legacy/Components/Inputs/TextInput",
  component: TextInput,
  parameters: { docs: { description: { component: description } } },
  args: { placeholder: "Scan or type a ref id" },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness() {
  const [value, setValue] = useState("");
  const [scanned, setScanned] = useState<string[]>([]);

  return (
    <Stack gap="2" w="320px">
      <TextInput
        value={value}
        onChange={setValue}
        onEnter={(v) => {
          setScanned((s) => [...s, v]);
          setValue("");
        }}
        placeholder="Scan a ref id"
      />
      <Text data-testid="scanned">{scanned.join(",") || "none"}</Text>
    </Stack>
  );
}

// THE scanner case. A barcode scanner is a keyboard that types the code and presses Enter, so half
// the receiving and picking fields have to act on it — and the keypress is consumed, so it never
// also submits the surrounding form.
export const EnterIsAScan: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId("text-input");

    await userEvent.type(input, "SKU-1{Enter}", { delay: 20 });
    await userEvent.type(input, "SKU-2{Enter}", { delay: 20 });

    await expect(canvas.getByTestId("scanned")).toHaveTextContent("SKU-1,SKU-2");
    // The field clears itself between scans, ready for the next one.
    await expect(input).toHaveValue("");
  },
};

// onChange gives the VALUE, not the event — every call site was writing `e.target.value`, and the
// ones that forgot stored a SyntheticEvent that only failed at submit time.
export const ReportsTheValue: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [v, setV] = useState("");
    return (
      <Stack gap="2" w="320px">
        <TextInput value={v} onChange={setV} />
        <Text data-testid="value">{v || "empty"}</Text>
      </Stack>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("text-input"), "abc", { delay: 20 });
    await expect(canvas.getByTestId("value")).toHaveTextContent("abc");
  },
};

export const InAFieldWithError: Story = {
  render: () => (
    <Field label="Ref id" error="This ref id is already used." required>
      <TextInput />
    </Field>
  ),
};

// The multi-line form. Fixed height on purpose: an auto-growing box shifts the rest of the form
// while you are still typing into it.
export const MultiLine: Story = {
  parameters: { docs: { description: { story: textareaDescription } } },
  render: () => (
    <Field label="Why was this adjusted?">
      <Textarea placeholder="Found two boxes behind the pallet" rows={3} />
    </Field>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("textarea")).toBeVisible();
  },
};
