import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../api/clients";
import { toaster } from "../components/feedback/Toaster";

/** One message of an export's stream — every export RPC answers this shape (code-implementation-guideline.md). */
export interface FileExportMessage {
  done: bigint;
  total: bigint;
  /** Set on the LAST message only: the file's expiring link, and its name. */
  downloadUrl: string;
  filename: string;
}

export interface FileExportProgress {
  done: number;
  total: number;
}

/**
 * A TABLE AS A FILE — the order list's export (one-export-is-the-list-as-a-file) for any screen's table
 * (each-supplier-tab-exports-its-own-table): it reads the stream's progress and, on the last message, downloads the file
 * from its expiring link, then says so in a toast.
 *
 * `start` takes the stream itself — `client.someExport({...})` — so each screen sends its own filter. `progress` is null
 * while nothing runs; a button reads it to say "Mengekspor 200 / 456".
 */
export function useFileExport() {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<FileExportProgress | null>(null);

  const start = useCallback(
    async (stream: AsyncIterable<FileExportMessage>) => {
      setProgress({ done: 0, total: 0 });

      try {
        let url = "";
        let filename = "";

        for await (const msg of stream) {
          setProgress({ done: Number(msg.done), total: Number(msg.total) });

          if (msg.downloadUrl) {
            url = msg.downloadUrl;
            filename = msg.filename;
          }
        }

        if (!url) {
          throw new Error(t("common.export.noFile"));
        }

        download(url, filename);
        toaster.create({ type: "success", title: t("common.export.ready") });
      } catch (err) {
        toaster.create({ type: "error", title: t("common.export.failed"), description: rpcError(err) });
      } finally {
        setProgress(null);
      }
    },
    [t],
  );

  return { start, progress, running: progress !== null };
}

/** Hands the browser the file — an anchor click, so the expiring link is fetched once, now. */
function download(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
