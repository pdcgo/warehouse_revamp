import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { asTeam } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { asAdminTeam } from "../../../.storybook/sessionScenario";
import { WriteRoute } from "./WriteRoute";

// WRITE ROUTE — what a route that only CHANGES something (a create or edit form, an accept, a count, a finalize) shows
// while the admin team monitors the team (the-admin-team-monitors-read-only). The screens offer no way in; a URL still
// does, and this is what it finds: a read-only notice and the way back, never a form whose submit would be refused.

const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

function TheForm() {
  return <Text data-testid="the-form">The form</Text>;
}

const meta = {
  title: "Features/Team/WriteRoute",
  component: WriteRoute,
  parameters: {
    // canWrite reads the current team, which needs the session.
    signedIn: true,
  },
  beforeEach: asTeam(WAREHOUSE.id),
  args: { children: <TheForm /> },
} satisfies Meta<typeof WriteRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

// A member of the team gets the form, untouched.
export const AMemberGetsTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("the-form", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.queryByTestId("read-only-route")).toBeNull();
  },
};

// The admin team, monitoring Gudang Pusat, is told the screen is read-only — and is offered Go Back, not the form.
export const AMonitorIsToldItIsReadOnly: Story = {
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const notice = await canvas.findByTestId("read-only-route", {}, { timeout: 4000 });
    await expect(notice).toHaveTextContent("Read-only");
    await expect(canvas.getByRole("button", { name: "Go Back" })).toBeVisible();
    await expect(canvas.queryByTestId("the-form")).toBeNull();
  },
};
