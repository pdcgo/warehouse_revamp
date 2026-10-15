import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { CompactActions, description } from "./CompactActions";

// A PHONE'S HEADER ACTIONS ARE ICONS, AND PAST TWO THEY FOLD (a-phone-header-action-is-an-icon).

const meta = {
  title: "Components/Chrome/CompactActions",
  component: CompactActions,
  parameters: { docs: { description: { component: description } } },
  args: { menuLabel: "Actions", menuTestId: "actions-menu", actions: [] },
} satisfies Meta<typeof CompactActions>;

export default meta;
type Story = StoryObj<typeof meta>;

const exportAction = { id: "export", label: "Export", icon: Download, testId: "act-export", onClick: fn() };
const importAction = { id: "import", label: "Import", icon: Upload, testId: "act-import", onClick: fn() };
const createAction = { id: "create", label: "New Order", icon: Plus, primary: true, testId: "act-create", onClick: fn() };

/** One or two actions — each an icon, named by its label; the committing one in the brand fill. No menu. */
export const TwoAreIcons: Story = {
  args: { actions: [exportAction, createAction] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("actions-menu")).toBeNull();

    const create = canvas.getByRole("button", { name: "New Order" });
    await expect(create).toHaveAttribute("data-testid", "act-create");
    await expect(create).not.toHaveTextContent("New Order");
    await userEvent.click(create);
    await expect((args.actions[1] as typeof createAction).onClick).toHaveBeenCalled();
  },
};

/** Three or more — all of them behind ⋯, each with its icon and its name; never two icons and a menu of one. */
export const ThreeFoldIntoTheMenu: Story = {
  args: { actions: [exportAction, importAction, createAction] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Export" })).toBeNull();

    await userEvent.click(canvas.getByTestId("actions-menu"));
    const create = await screen.findByTestId("act-create");
    await waitFor(() => expect(create).toBeVisible());
    await expect(create).toHaveTextContent("New Order");
    await expect(screen.getByTestId("act-export")).toHaveTextContent("Export");
  },
};

/** An action this person may not take is passed as `false` and left out — two remain, so they are icons. */
export const ALeftOutActionDoesNotCount: Story = {
  args: { actions: [exportAction, false, { id: "delete", label: "Delete", icon: Trash2, danger: true, testId: "act-delete" }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("actions-menu")).toBeNull();
    await expect(canvas.getByRole("button", { name: "Delete" })).toBeVisible();
  },
};
