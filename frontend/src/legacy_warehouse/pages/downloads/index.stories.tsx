import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { APP_BUILDS } from "../../fixtures";
import { DownloadsPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/Downloads",
  component: DownloadsPage,
  parameters: { docs: { description: { component: description } } },
  args: { builds: APP_BUILDS },
} satisfies Meta<typeof DownloadsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("build-card")).toHaveLength(3);
  },
};

// ⚠ NOTHING HERE CAN FORCE AN UPDATE, and the screen says so. Publishing a build is not the same as
// deploying it, and a handheld can sit on an old one indefinitely with the floor unable to tell.
export const PublishingIsNotDeploying: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("no-force-note")).toHaveTextContent("Installing is manual");
  },
};

// Current and older are separated, because on a screen with no forced updates "which one should I
// install" is the actual question.
export const CurrentIsSeparatedFromOlder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const cards = canvas.getAllByTestId("build-card");
    await expect(cards.filter((c) => c.getAttribute("data-current") === "true")).toHaveLength(2);
    await expect(canvas.getAllByTestId("current-badge")).toHaveLength(2);
  },
};

// The release note is doing real work here, not decoration: it is the only thing telling somebody
// whether the walk to the charging rack is worth it.
export const TheReleaseNoteIsTheDecision: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Duplicate scans now sound different from errors")).toBeVisible();
  },
};

// Old builds are kept on purpose — a bad build sometimes has to be rolled back on a handheld with no
// connection to do it over.
export const OldBuildsStayInstallable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("v2.3.0 · 18.1 MB")).toBeVisible();
    await expect(canvas.getAllByTestId("download")).toHaveLength(3);
  },
};

export const OnlyCurrentBuilds: Story = {
  args: { builds: APP_BUILDS.filter((b) => b.current) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("build-card")).toHaveLength(2);
    await expect(canvas.queryByText("Older")).toBeNull();
  },
};
