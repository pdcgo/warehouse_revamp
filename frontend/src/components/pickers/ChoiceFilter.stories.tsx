import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Text } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ChoiceFilter, description } from "./ChoiceFilter";

// ONE OF A FEW FIXED CHOICES, AS A FILTER — the Team Balance list's team type, the products list's lock and stock age.
//
//   | story                        | the rule it pins                                                          |
//   | ---------------------------- | ------------------------------------------------------------------------- |
//   | NothingPickedReadsAsAny      | the placeholder is the "any" answer, and no × while nothing is picked      |
//   | APickNarrowsAndItsXClears    | a pick emits its value; its × sets it back to "any", emitting `undefined` |
//   | ItIsChakrasSelectNotANative  | the trigger is a button over a listbox — never a native `<select>`       |

const OPTIONS = [
  { value: "1", label: "Warehouse team" },
  { value: "2", label: "Selling team" },
];

// A real controlled caller, so a pick and a clear round-trip through state (a pinned `value` would snap back).
function Controlled({ initial }: { initial?: string }) {
  const [value, setValue] = useState<string | undefined>(initial);

  return (
    <Box w="48">
      <ChoiceFilter value={value} onChange={setValue} options={OPTIONS} placeholder="All teams" testId="kind" />
      <Text mt="2" fontSize="xs" data-testid="kind-value">
        {value ?? "any"}
      </Text>
    </Box>
  );
}

const meta = {
  title: "Components/Pickers/ChoiceFilter",
  component: ChoiceFilter,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: undefined, onChange: () => {}, options: OPTIONS, placeholder: "All teams", testId: "kind" },
  render: () => <Controlled />,
} satisfies Meta<typeof ChoiceFilter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingPickedReadsAsAny: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("kind")).toHaveTextContent("All teams");
    // Zag hides the × while nothing is picked.
    await expect(canvas.getByTestId("kind-clear")).not.toBeVisible();
  },
};

export const APickNarrowsAndItsXClears: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("kind"));
    // Inline, never portalled — the option is inside the canvas, so it also works inside the phone's Filter sheet.
    const option = await canvas.findByTestId("kind-option-1");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("kind-value")).toHaveTextContent("1"));
    await expect(canvas.getByTestId("kind")).toHaveTextContent("Warehouse team");

    // The × sets it back to "any" — the none sentinel, never nothing.
    const clear = canvas.getByTestId("kind-clear");
    await waitFor(() => expect(clear).toBeVisible());
    await userEvent.click(clear);
    await waitFor(() => expect(canvas.getByTestId("kind-value")).toHaveTextContent("any"));
    await expect(canvas.getByTestId("kind")).toHaveTextContent("All teams");
  },
};

// chakra-first-whenever-it-has-the-component: a NativeSelect only wraps the browser's `<select>`, which Chakra's full
// Select replaces. The trigger is a button; the native `<select>` present is Select.HiddenSelect's, for forms only.
export const ItIsChakrasSelectNotANative: Story = {
  render: () => <Controlled initial="2" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId("kind");

    await expect(trigger.tagName).toBe("BUTTON");
    await expect(trigger).toHaveTextContent("Selling team");
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.getByRole("listbox")).toBeVisible());
  },
};
