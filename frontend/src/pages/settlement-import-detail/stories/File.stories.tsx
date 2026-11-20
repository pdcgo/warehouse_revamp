import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { formatUnixDateTime } from "../../../lib/datetime";
import { AtFailed, AtInterrupted, AtUnknown, IMPORT_DETAIL_META, loaded, shopeeDone, shopOf } from "./kit";

// IMPORT DETAIL — the file itself: its shop, its range, its tally, the original to download, what an interrupted or a
// failed file says, and that nothing undoes an import. The page's stories are grouped by the part of the screen they
// are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Settlement/ImportDetail/File",
  ...IMPORT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The header is the file: its shop, its own range, and what became of its rows.
export const TheFileAndItsTally: Story = {
  name: "Shop, range and tally",
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

// WHO UPLOADED IT, AND WHEN — the time in the app's language and in WIB, the full form a detail page keeps
// (a-table-date-is-short-and-every-time-is-wib); never the browser's own format (9/28/2026, 9:10:00 AM).
export const UploadedByInWib: Story = {
  name: "Uploaded by, in WIB",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const at = formatUnixDateTime(shopeeDone!.createdAt.seconds);

    const by = canvas.getByTestId("import-detail-uploaded-by");
    await waitFor(() => expect(by).toHaveTextContent(/^Uploaded by (?!#).+, /));
    await expect(by).toHaveTextContent(`, ${at}`);
    // 2026-09-28 09:10 WIB, read in English.
    await expect(by).toHaveTextContent(/Sep 28, 2026\D+09:10/);
    await expect(by).not.toHaveTextContent("9/28/2026");
  },
};

// The original is one click away, through a signed URL minted when asked.
export const TheOriginalDownloads: Story = {
  name: "Download the original",
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
  name: "Nothing undoes it",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByRole("button", { name: /revert|reprocess|undo|delete/i })).toBeNull();
  },
};

export const AnInterruptedFileSaysHowToFinishIt: Story = {
  name: "Interrupted · how to finish",
  render: () => <AtInterrupted />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("import-detail-interrupted")).toHaveTextContent("Upload the same file again");
  },
};

export const AFailedFileShowsWhy: Story = {
  name: "Failed · why",
  render: () => <AtFailed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("import-detail-failure")).toHaveTextContent("belong to Melati Store");
  },
};

// Another team's file — or one that does not exist — is simply not found.
export const AnUnknownFileIsNotFound: Story = {
  name: "Unknown · not found",
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("import-detail-not-found", {}, { timeout: 3000 })).toBeInTheDocument();
  },
};
