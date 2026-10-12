import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { settlementImportLines, settlementImports, shops, teams } from "../../../.storybook/fixtures";
import {
  UploadedFileLineOutcome,
  UploadedFileLineReason,
} from "../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { SettlementImportDetailPage } from "./index";

// ⚠ PROTOTYPE for design_accept — docs/business/settlement/settlement_importer_decision.md.
//
// One imported statement: what it posted, and the rows worth a look — held, skipped, or posted to the
// shop because their order was not found. The tallies on the page and the rows under each view come from
// the same fixture book, so a story checks one against the other.

const TEAM = teams.find((t) => t.id === 12n)!; // Toko Melati
const [shopeeDone, , interrupted, failed] = settlementImports;
const shopOf = (id: bigint) => shops.find((s) => s.id === id)!;
const linesOf = (fileId: bigint, pick: (l: (typeof settlementImportLines)[number]) => boolean) =>
  settlementImportLines.filter((l) => l.uploadedFileId === fileId).filter(pick);

// Built ONCE per starting URL, at module scope (see pageStory.tsx).
const routes = [
  { path: "/settlement/imports/:fileId", element: <SettlementImportDetailPage /> },
  marker("/settlement/imports", "at-imports"),
];
const AtShopeeDone = routedPage(routes, `/settlement/imports/${shopeeDone!.id}`);
const AtInterrupted = routedPage(routes, `/settlement/imports/${interrupted!.id}`);
const AtFailed = routedPage(routes, `/settlement/imports/${failed!.id}`);
const AtUnknown = routedPage(routes, "/settlement/imports/999");

const meta = {
  title: "Pages/Settlement/ImportDetail",
  component: SettlementImportDetailPage,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: asTeam(TEAM.id),
  render: () => <AtShopeeDone />,
} satisfies Meta<typeof SettlementImportDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("import-detail-shop")).toBeInTheDocument(), { timeout: 3000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const Interrupted: Story = { render: () => <AtInterrupted /> };

export const Failed: Story = { render: () => <AtFailed /> };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// The header is the file: its shop, its own range, and what became of its rows.
export const TheFileAndItsTally: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The shop's name arrives with the shop list, a beat after the file.
    await waitFor(() =>
      expect(canvas.getByTestId("import-detail-shop")).toHaveTextContent(shopOf(shopeeDone!.shopId).name),
    );
    await expect(canvas.getByTestId("import-detail-period")).toHaveTextContent(
      `${shopeeDone!.periodFrom} – ${shopeeDone!.periodTo}`,
    );
    await expect(canvas.getByTestId("tally-posted-value")).toHaveTextContent(String(shopeeDone!.tally.posted));
    await expect(canvas.getByTestId("tally-held-value")).toHaveTextContent(String(shopeeDone!.tally.held));
  },
};

// HELD rows come first: they are the ones a person can do something about — and the page says what.
export const HeldRowsSayWhyAndWhatToDo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const held = linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.HELD);

    for (const line of held) {
      await canvas.findByTestId(`line-row-${line.id}`);
    }
    await expect(canvas.getByTestId(`line-reason-${held[0]!.id}`)).toHaveTextContent("nobody has mapped");
    await expect(canvas.getByTestId(`line-reason-${held[1]!.id}`)).toHaveTextContent("Refused by settlement");
    await expect(canvas.getByTestId("lines-note")).toHaveTextContent("upload the same file again");
  },
};

// only-a-successful-withdrawal-is-recorded: a failed withdrawal and its refund are skipped, and say so.
export const SkippedRowsSayWhy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("lines-tab-skipped"));

    for (const line of linesOf(shopeeDone!.id, (l) => l.outcome === UploadedFileLineOutcome.SKIPPED)) {
      const reason = await canvas.findByTestId(`line-reason-${line.id}`);
      await expect(reason).toHaveTextContent("did not succeed");
    }
  },
};

// an-unmatched-ref-posts-to-the-shop: a row whose order was not found went to the shop — and the page
// says an order entered later will not receive it.
export const RowsPostedToTheShop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("lines-tab-toShop"));

    for (const line of linesOf(shopeeDone!.id, (l) => l.reason === UploadedFileLineReason.NO_ORDER)) {
      const reason = await canvas.findByTestId(`line-reason-${line.id}`);
      await expect(reason).toHaveTextContent("No order with this ref");
    }
    await expect(canvas.getByTestId("lines-note")).toHaveTextContent("does not receive them");
  },
};

// The original is one click away, through a signed URL minted when asked.
export const TheOriginalDownloads: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const open = spyOn(window, "open").mockReturnValue(null);

    await userEvent.click(canvas.getByTestId("download-original"));

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        `https://example.invalid/proof/${shopeeDone!.documentId}`,
        "_blank",
        "noopener,noreferrer",
      ),
    );
    open.mockRestore();
  },
};

// an-upload-is-never-reverted · the-row-key-is-the-only-dedupe: nothing here undoes an import, and there
// is no Reprocess — the same file again is the retry.
export const NothingUndoesAnImport: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByRole("button", { name: /revert|reprocess|undo|delete/i })).toBeNull();
  },
};

export const AnInterruptedFileSaysHowToFinishIt: Story = {
  render: () => <AtInterrupted />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("import-detail-interrupted")).toHaveTextContent("Upload the same file again");
  },
};

export const AFailedFileShowsWhy: Story = {
  render: () => <AtFailed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("import-detail-failure")).toHaveTextContent("belong to Melati Store");
  },
};

// Another team's file — or one that does not exist — is simply not found.
export const AnUnknownFileIsNotFound: Story = {
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("import-detail-not-found", {}, { timeout: 3000 })).toBeInTheDocument();
  },
};
