import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { FORMER_USER_ID } from "../../../../.storybook/fixtures";
import { type HeldRpc, callsOf, holdRpc } from "../../../../.storybook/holdRpc";
import { rackHistoryByForStory, rackSampleForStory } from "../../../../.storybook/rackStub";
import { rackClient } from "../../../api/clients";
import { RACK_DETAIL_META, loaded, openMove, openSample, pickRack, type } from "./kit";

// RACK DETAIL — Riwayat, one ledger with two lenses: every movement, or Penempatan — what decided goods live here. Who
// moved it, a former user, and who received a sample. The page's stories are grouped by the part of the screen they are about
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

// WHO RECEIVED A SAMPLE (a-sample-keeps-its-recipient; placement.md given 17 — *sample in the rack's history with who
// received it*): 2 Kopi handed to Pak Budi off A-01-1 — the sample row says *given to Pak Budi* on a line of its own under
// what happened, and no other row names anybody. The staff's note is not that line.
export const ASampleNamesWhoReceivedIt: Story = {
  name: "A sample names who received it",
  beforeEach: () => rackSampleForStory(41n, 71n, 2n, "Pak Budi", "for the product photos"),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = await canvas.findByTestId("rack-history-table", {}, { timeout: 4000 });

    await waitFor(() => expect(table).toHaveTextContent(/sample/i));
    const lines = table.querySelectorAll<HTMLElement>('[data-testid^="rack-history-row-"][data-testid$="-recipient"]');
    await expect(lines).toHaveLength(1);
    await expect(lines[0]).toHaveTextContent(/^given to Pak Budi$/);
    // On the sample's own row — the one that took 2 off the shelf.
    const row = lines[0].closest<HTMLElement>('tr[data-testid^="rack-history-row-"]');
    await expect(row).not.toBeNull();
    await expect(row!).toHaveTextContent(/sample/i);
    await expect(row!).toHaveTextContent("-2");
    await expect(table).not.toHaveTextContent("for the product photos");
  },
};

// …and on a phone: the block's own line under *Sampel · Kopi Arabika 250g · …*, nothing past the screen's edge.
export const ASampleNamesWhoReceivedItOnAPhone: Story = {
  name: "A sample names who received it, phone",
  globals: { viewport: { value: "mobile1" } },
  beforeEach: () => rackSampleForStory(41n, 71n, 2n, "Pak Budi", "for the product photos"),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const ledger = await canvas.findByTestId("rack-history-table", {}, { timeout: 4000 });

    await waitFor(() => expect(ledger).toHaveTextContent(/sample/i));
    await expect(ledger.tagName).not.toBe("TABLE");
    const lines = ledger.querySelectorAll<HTMLElement>('[data-testid^="rack-history-row-"][data-testid$="-recipient"]');
    await expect(lines).toHaveLength(1);
    await expect(lines[0]).toHaveTextContent(/^given to Pak Budi$/);
    await expect(lines[0]).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// RIWAYAT IS ASKED WITH THE RACK (#134, the-speed-audits-old-findings-are-fixed-smallest-first) — the ledger needs only
// the address's rack, but its section mounts only once the rack itself is named, so its read waited for RackDetail. The
// page asks it beside the rack and the shelf (useRackLedger); the page still draws once the rack is named.
let rackHeld: HeldRpc | undefined;

export const RiwayatIsAskedWithTheRack: Story = {
  name: "Riwayat asked with the rack",
  beforeEach: () => {
    // The rack answers late — its ledger goes out meanwhile.
    rackHeld = holdRpc(rackClient, "rackDetail");
    const spy = spyOn(rackClient, "rackHistory");

    return () => {
      rackHeld?.restore();
      spy.mockRestore();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(callsOf(rackClient.rackHistory)).toHaveLength(1), { timeout: 5000 });
    await expect(canvas.getByTestId("rack-detail-loading")).toBeInTheDocument();

    rackHeld?.release();
    await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("rack-history-table")).toBeVisible(), { timeout: 5000 });
    await expect(callsOf(rackClient.rackHistory)).toHaveLength(1);
  },
};
