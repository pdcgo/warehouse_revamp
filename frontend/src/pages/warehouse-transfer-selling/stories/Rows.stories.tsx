import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { FORMER_USER_ID } from "../../../../.storybook/fixtures";
import { transferRaisedByForStory } from "../../../../.storybook/warehouseTransferStub";
import { SELLING_META, loaded, openedByRoot } from "./kit";

// TRANSFER SELLING — what a DESKTOP row shows, what it opens, and its ⋯. The page's stories are grouped by the part of
// the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/WarehouseTransfer/TransferSelling/Rows",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE DESKTOP KEEPS ITS TABLE — the phone's blocks are below `md` only; the labelled New Transfer, no phone title.
export const ADesktopReadsATable: Story = {
  name: "A desktop reads a table",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(1440);
    await expect(canvas.getByTestId("transfers-table").tagName).toBe("TABLE");
    await expect(canvasElement.querySelector("[data-layout]")).toBeNull();
    await expect(canvas.getByTestId("open-create-transfer")).toHaveTextContent("New Transfer");
  },
};

// A FORMER USER (erase-keeps-the-row): a transfer raised by somebody since erased still names them — "Former user #69",
// never the synthetic username `erased69`.
export const RaisedByAFormerUser: Story = {
  name: "Raised by a former user",
  beforeEach: () => transferRaisedByForStory(601n, FORMER_USER_ID),
  play: async ({ canvasElement }) => {
    const row = (await loaded(canvasElement)).getByTestId("transfer-row-601");

    await waitFor(() => expect(row).toHaveTextContent("Former user #69"));
    await expect(row).not.toHaveTextContent("erased69");
  },
};

// The team's own transfers, newest first, and only its own — another team's leaving the same warehouse is not here.
export const OnlyTheTeamsOwn: Story = {
  name: "Only the team's own",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("transfer-row-608")).toBeInTheDocument();
    await expect(canvas.queryByTestId("transfer-row-609")).toBeNull();
    // The route by NAME, once the lookup lands.
    await waitFor(() =>
      expect(canvas.getByTestId("transfer-route-601")).toHaveTextContent(/Gudang Pusat.*Gudang Cabang/),
    );
  },
};

// Broken and missing units are the team's loss, so the row says so without opening it.
export const ProblemsAreOnTheRow: Story = {
  name: "Problems are on the row",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("transfer-problems-605")).toHaveTextContent(/2/);
    await expect(canvas.queryByTestId("transfer-problems-601")).toBeNull();
  },
};

// A row's ⋯ offers what its status allows: a shipped transfer can be given up, never cancelled.
export const ShippedRowOffersMarkLost: Story = {
  name: "A shipped row offers Mark Lost",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-actions-603"));
    const items = await screen.findAllByRole("menuitem", {}, { timeout: 2000 });
    await waitFor(() => expect(items[0]).toBeVisible());
    const ids = screen.getAllByRole("menuitem").map((item) => item.dataset.testid ?? "");

    await expect(ids).toContain("transfer-action-mark-lost-603");
    await expect(ids).not.toContain("transfer-action-cancel-603");
  },
};

export const OpensTheDetail: Story = {
  name: "A row opens the transfer",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-row-601"));
    await canvas.findByTestId("at-transfer-detail");
  },
};

export const OpensTheCreateForm: Story = {
  name: "New Transfer opens the form",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-transfer"));
    await canvas.findByTestId("at-transfer-new");
  },
};

// OPENED BY ROOT FROM OUTSIDE (an-override-shows-a-platform-badge): the row names Fajar under its number with the "by
// Root team" badge. No other row carries one.
export const OpenedByRootFromOutside: Story = {
  name: "Opened by Root from outside",
  beforeEach: openedByRoot,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const created = await canvas.findByTestId("transfer-created-by-601");

    await waitFor(() => expect(created).toHaveTextContent("by Fajar Nugroho"));
    await expect(within(created).getByTestId("root-team-badge")).toHaveTextContent("by Root team");
    await expect(within(canvas.getByTestId("transfers-table")).getAllByTestId("root-team-badge")).toHaveLength(1);
    await expect(within(canvas.getByTestId("transfer-row-602")).queryByTestId("root-team-badge")).toBeNull();
  },
};
