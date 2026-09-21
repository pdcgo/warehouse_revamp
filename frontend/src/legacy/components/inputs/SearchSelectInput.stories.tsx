import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SearchSelectInput, description, type SearchSelectInputProps } from "./SearchSelectInput";

const CATALOGUE = [
  { value: "8842", label: "Kaos Polos Hitam L" },
  { value: "8843", label: "Kaos Polos Putih M" },
  { value: "9001", label: "Hoodie Abu XL" },
  { value: "9002", label: "Hoodie Navy L" },
];

// Named prop type, not `typeof SearchSelectInput` — inferring from a generic collapses T.
const meta: Meta<SearchSelectInputProps<string>> = {
  title: "Legacy/Components/Inputs/SearchSelectInput",
  component: SearchSelectInput,
  parameters: { docs: { description: { component: description } } },
  args: { items: CATALOGUE },
};

export default meta;
type Story = StoryObj<SearchSelectInputProps<string>>;

function Harness(props: { slow?: boolean }) {
  const [text, setText] = useState("");
  const [value, setValue] = useState<string>();

  // Stands in for the server-side lookup the real caller performs.
  const items = useMemo(
    () => (text ? CATALOGUE.filter((c) => c.label.toLowerCase().includes(text.toLowerCase())) : CATALOGUE),
    [text],
  );

  return (
    <Box w="320px">
      <SearchSelectInput
        items={props.slow ? [] : items}
        loading={props.slow}
        inputValue={text}
        onInputChange={setText}
        value={value}
        onChange={setValue}
      />
    </Box>
  );
}

export const Searching: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("search-select-input"));
    await userEvent.type(canvas.getByTestId("search-select-input"), "hoodie", { delay: 20 });

    await waitFor(async () => {
      await expect(screen.getByTestId("search-select-item-9001")).toBeVisible();
    });
  },
};

// ⚠ THE RULE. An empty list means two different things — "no matches" and "still asking" — and a
// picker that shows the same blank panel for both reads as broken exactly when the network is slow.
export const SearchingIsNotTheSameAsNoMatches: Story = {
  render: () => <Harness slow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("search-select-input"));

    await waitFor(async () => {
      await expect(screen.getByTestId("search-select-searching")).toBeVisible();
    });
    await expect(screen.queryByTestId("search-select-empty")).toBeNull();
  },
};

export const NoMatches: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("search-select-input"));

    await waitFor(async () => {
      await expect(screen.getByTestId("search-select-empty")).toBeVisible();
    });
  },
};
