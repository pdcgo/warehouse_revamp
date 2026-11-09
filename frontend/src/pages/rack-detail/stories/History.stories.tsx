import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { FORMER_USER_ID } from "../../../../.storybook/fixtures";
import { rackHistoryByForStory } from "../../../../.storybook/rackStub";
import { RACK_DETAIL_META, loaded, openMove, openSample, pickRack, type } from "./kit";

// RACK DETAIL — Riwayat, one ledger with two lenses: every movement, or Penempatan — what decided goods live here. Who
// moved it, and a former user. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/History",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// PENEMPATAN IS A LENS, NOT A SECOND LEDGER (the Riwayat Penempatan tab, folded in): after a move and a sample, Semua
// shows both; Penempatan keeps the move — it decided where goods live — and drops the sample, which only changed a count.
export const PlacementIsALens: Story = {
  name: "Penempatan lens",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await openMove();
    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-71-0"), "4");
    await userEvent.click(screen.getByTestId("move-submit"));
    await waitFor(() => expect(screen.queryByTestId("move-goods-dialog")).toBeNull());

    await openSample();
    await type(await screen.findByTestId("sample-qty-73"), "1");
    await type(screen.getByTestId("sample-recipient"), "Pak Budi");
    await userEvent.click(screen.getByTestId("sample-submit"));
    await waitFor(() => expect(screen.queryByTestId("record-sample-dialog")).toBeNull());

    await waitFor(() => expect(canvas.getByTestId("rack-history-table")).toHaveTextContent(/sample/i));
    await expect(canvas.getByTestId("rack-history-table")).toHaveTextContent(/moved/i);

    await userEvent.click(canvas.getByTestId("rack-history-filter-placement"));
    await expect(canvas.getByTestId("rack-history-filter-placement")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(canvas.getByTestId("rack-history-table")).not.toHaveTextContent(/sample/i));
    await expect(canvas.getByTestId("rack-history-table")).toHaveTextContent(/moved/i);

    await userEvent.click(canvas.getByTestId("rack-history-filter-all"));
    await waitFor(() => expect(canvas.getByTestId("rack-history-table")).toHaveTextContent(/sample/i));
  },
};

// WHO DID IT (any-warehouse-member-may-move-goods — every row names its person): after a move, Riwayat shows the move
// with the product's name and the person who made it — the signed-in staff member, Ani Rahayu.
export const PlacementHistoryNamesWhoMovedIt: Story = {
  name: "Names who moved it",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openMove();

    await pickRack("move-default-to", 42n);
    await type(screen.getByTestId("move-qty-71-0"), "4");
    await userEvent.click(screen.getByTestId("move-submit"));
    await waitFor(() => expect(screen.queryByTestId("move-goods-dialog")).toBeNull());

    await userEvent.click(canvas.getByTestId("rack-history-filter-placement"));
    const table = await canvas.findByTestId("rack-history-table");

    await waitFor(() => expect(table).toHaveTextContent(/moved/i));
    await expect(table).toHaveTextContent("Kopi Arabika 250g");
    await expect(table).toHaveTextContent("Ani Rahayu");
    await expect(table).toHaveTextContent("-4");
  },
};

// A FORMER USER (erase-keeps-the-row): the history still names whoever moved the goods after their account was erased —
// as "Former user #69", never the synthetic username `erased69`.
export const HistoryNamesAFormerUser: Story = {
  name: "A former user",
  beforeEach: () => rackHistoryByForStory(FORMER_USER_ID),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = await canvas.findByTestId("rack-history-table", {}, { timeout: 4000 });

    await waitFor(() => expect(table).toHaveTextContent("Former user #69"));
    await expect(table).not.toHaveTextContent("erased69");
  },
};
