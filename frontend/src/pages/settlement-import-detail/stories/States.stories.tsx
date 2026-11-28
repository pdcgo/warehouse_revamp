import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { settlementImportScenario } from "../../../../.storybook/settlementImportScenario";
import { AtFailed, AtInterrupted, IMPORT_DETAIL_META, loaded } from "./kit";

// IMPORT DETAIL — the plain looks other than Default: a file the server stopped mid-way, and a file refused whole; then
// the first loads on a desktop, each its shape and never a spinner on an empty page (motion-is-small-quick-and-shared —
// the phone's are in ./Phone.stories.tsx and ./PhoneRows.stories.tsx). The page's stories are grouped by the part of the
// screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Settlement/ImportDetail/States",
  ...IMPORT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interrupted: Story = { render: () => <AtInterrupted /> };

export const Failed: Story = { render: () => <AtFailed /> };

// THE FILE'S FIRST LOAD — the page's shape, a title bar and rows; never a spinner.
export const LoadingTheFile: Story = {
  name: "Loading the file",
  beforeEach: () => {
    settlementImportScenario.fileHoldMs = 60_000;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("import-detail-loading")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.queryByTestId("import-detail-shop")).toBeNull();
    await expect(canvasElement.querySelector(".chakra-spinner")).toBeNull();
    await expect(canvas.getByTestId("back-to-imports")).toBeVisible();
  },
};

// A TAB'S FIRST LOAD — the file is there, its rows on their way: bars where the table will be, under the tally and tabs.
export const LoadingTheRows: Story = {
  name: "Loading a tab's rows",
  beforeEach: () => {
    settlementImportScenario.linesHoldMs = 60_000;
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("lines-loading")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.getByTestId("file-tally")).toBeVisible();
    await expect(canvas.getByTestId("lines-tab-held")).toBeVisible();
    await expect(canvas.queryByTestId("lines-table")).toBeNull();
    await expect(canvasElement.querySelector(".chakra-spinner")).toBeNull();
    await expect(canvas.getByTestId("lines-pager")).toBeVisible();
  },
};
