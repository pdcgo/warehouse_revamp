import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { PROBLEM_ROWS } from "../../fixtures";
import { ProblemItemsPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/ProblemItems",
  component: ProblemItemsPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: PROBLEM_ROWS },
} satisfies Meta<typeof ProblemItemsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Three of the four are open; the resolved one is not on the list.
    await expect(canvas.getAllByTestId("problem-age")).toHaveLength(3);
  },
};

// ⚠ AGE IS A FIRST-CLASS COLUMN, and old open rows are marked. Nothing removes a row from a problem
// list except a person deciding — so a six-week-old row is a forgotten one, and it looks identical
// to a six-hour-old one without the date.
export const OldOpenProblemsAreMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const ages = canvas.getAllByTestId("problem-age");
    const stale = ages.filter((a) => a.getAttribute("data-stale") === "true");
    await expect(stale).toHaveLength(1);
    await expect(stale[0]).toHaveTextContent("43d");
  },
};

// ⚠ THE COUNT THAT MATTERS IS THE UNTOUCHED ONE. A total goes up and down with normal breakage;
// this number only goes up when the team stops deciding.
export const TheWarningCountsWhatNobodyIsWorkingOn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("stale-warning")).toHaveTextContent("1 open longer than 14 days");
  },
};

// ⚠ THE NOTE IS A COLUMN, NOT A HOVER. It is the only field that says WHY, and it is exactly what
// the person deciding needs — hiding it means the decision is made without it.
export const TheReasonIsVisibleWithoutHovering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Water damage on the top layer of the carton")).toBeVisible();
    await expect(canvas.getByText("Counted short, not found on the rack")).toBeVisible();
  },
};

// Resolved rows leave the list. They are not deleted — they are simply not what this screen is for,
// which is the outstanding decisions.
export const ResolvedRowsAreNotHere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByText("Supplier sent the black variant")).toBeNull();
  },
};

export const FilterByKind: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: /^Lost/ }));
    await expect(canvas.getAllByTestId("problem-age")).toHaveLength(1);

    // Clearable — a filter you cannot turn off is a screen stuck on one question.
    await userEvent.click(canvas.getByRole("button", { name: /^Lost/ }));
    await expect(canvas.getAllByTestId("problem-age")).toHaveLength(3);
  },
};

export const NothingOutstanding: Story = {
  args: { rows: PROBLEM_ROWS.map((r) => ({ ...r, resolved: true })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("problem-table")).toHaveTextContent("Nothing outstanding");
    await expect(canvas.queryByTestId("stale-warning")).toBeNull();
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };
