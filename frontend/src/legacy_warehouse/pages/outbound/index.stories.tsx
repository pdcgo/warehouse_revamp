import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { OUTBOUND_ROWS } from "../../fixtures";
import { OutboundPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/Outbound",
  component: OutboundPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: OUTBOUND_ROWS },
} satisfies Meta<typeof OutboundPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("result-count")).toHaveTextContent("7 of 7 orders");
  },
};

// ⚠ AN EMPTY RESULT AND AN EMPTY WAREHOUSE MUST NOT LOOK THE SAME. On a screen where a mis-set
// filter is the normal cause of "nothing here", the message has to say which of the two it is —
// otherwise the operator concludes the work is done.
export const NoMatchesSaysSoDifferentlyFromNoWork: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.selectOptions(within(canvas.getByTestId("filter-team")).getByRole("combobox"), "Toko Anggrek");
    await userEvent.type(canvas.getByTestId("filter-awb"), "ZZZZ");

    await expect(canvas.getByTestId("movement-table")).toHaveTextContent("No orders match these filters");
  },
};

export const NothingToSend: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("movement-table")).toHaveTextContent("Nothing to send");
  },
};

// ⚠ ACTIVE FILTERS ARE LISTED AND INDIVIDUALLY REMOVABLE — the best thing on this screen. Without it
// a filter set three screens ago silently narrows everything the operator sees afterwards.
export const ActiveFiltersAreVisibleAndRemovable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.selectOptions(within(canvas.getByTestId("filter-team")).getByRole("combobox"), "Toko Melati");
    await expect(canvas.getByTestId("active-filter-team")).toHaveTextContent("Toko Melati");
    await expect(canvas.getByTestId("result-count")).toHaveTextContent("3 of 7");

    await userEvent.click(canvas.getByTestId("active-filter-team"));
    await expect(canvas.queryByTestId("active-filters")).toBeNull();
    await expect(canvas.getByTestId("result-count")).toHaveTextContent("7 of 7");
  },
};

export const ClearAll: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.selectOptions(within(canvas.getByTestId("filter-team")).getByRole("combobox"), "Toko Melati");
    await userEvent.selectOptions(within(canvas.getByTestId("filter-status")).getByRole("combobox"), "completed");
    await expect(canvas.getAllByTestId(/^active-filter-/)).toHaveLength(2);

    await userEvent.click(canvas.getByTestId("clear-filters"));
    await expect(canvas.queryByTestId("active-filters")).toBeNull();
  },
};

// ⚠ THE COUNT IS "n OF m", NOT "n". The denominator is what tells the operator their filter is the
// reason the list is short — a bare count of the filtered rows reads as the whole warehouse.
export const TheCountShowsWhatIsBeingExcluded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.selectOptions(within(canvas.getByTestId("filter-status")).getByRole("combobox"), "packing_completed");
    await expect(canvas.getByTestId("result-count")).toHaveTextContent("3 of 7 orders");
  },
};

// This screen answers "what is LEFT to do", which is the question scanning cannot answer — and the
// reason the rewrite did not replace it. See the description, and `outbound-experimental`.
export const FilteringAnswersWhatIsLeft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.selectOptions(within(canvas.getByTestId("filter-status")).getByRole("combobox"), "waiting");
    await expect(canvas.getByTestId("result-count")).toHaveTextContent("1 of 7");
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };
