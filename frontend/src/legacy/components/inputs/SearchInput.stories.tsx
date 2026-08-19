import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SearchInput, description } from "./SearchInput";

const meta = {
  title: "Legacy/Components/Inputs/SearchInput",
  component: SearchInput,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness() {
  const [reported, setReported] = useState<string>("");
  const [count, setCount] = useState(0);

  return (
    <>
      <SearchInput
        onChange={(v) => {
          setReported(v);
          setCount((c) => c + 1);
        }}
      />
      <Text data-testid="reported">{reported || "none"}</Text>
      <Text data-testid="count">{count}</Text>
    </>
  );
}

// THE point of the debounce: a six-letter search is ONE report, not six. With staleTime 0 every
// report is also a refetch and a table re-render, so undebounced typing is six round trips.
export const DebouncesToOneReport: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("search-input"), "kaos", { delay: 20 });

    await waitFor(async () => {
      await expect(canvas.getByTestId("reported")).toHaveTextContent("kaos");
    });
    await expect(canvas.getByTestId("count")).toHaveTextContent("1");
  },
};

// Clear appears only when there is something to clear, and reports IMMEDIATELY — it is a deliberate
// action, not a pause in typing, so waiting out the debounce would make the button feel broken.
export const ClearIsImmediate: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("search-clear")).toBeNull();

    await userEvent.type(canvas.getByTestId("search-input"), "kaos", { delay: 20 });
    await waitFor(async () => {
      await expect(canvas.getByTestId("search-clear")).toBeVisible();
    });

    await userEvent.click(canvas.getByTestId("search-clear"));
    await expect(canvas.getByTestId("reported")).toHaveTextContent("none");
  },
};

// Typing must never wait on the network: the text is local state, so characters appear instantly
// however slow the lookup is. A controlled-from-the-server search box drops characters.
export const TypingIsInstant: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const input = canvas.getByTestId("search-input");
    await userEvent.type(input, "hoodie", { delay: 10 });

    await expect(input).toHaveValue("hoodie");
  },
};
