import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { orderClient, rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { OrderExportView, type OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { orderListFilterMsg, type OrderFilters } from "./queries";

export interface OrderExportArgs {
  teamId: bigint;
  /** The list's own filter and status tab — the file holds exactly the rows the list holds. */
  filters: OrderFilters;
  status: OrderStatus;
  /** Whose columns: the seller's list or the warehouse's. */
  view: OrderExportView;
  /** The ticked rows, when a selection is exported. Empty = every row the filter holds. */
  orderIds?: bigint[];
}

export interface OrderExportProgress {
  done: number;
  total: number;
}

/**
 * THE LIST AS A FILE (one-export-is-the-list-as-a-file) — one hook for both lists. It reads the stream's progress and,
 * on the last message, downloads the file from its expiring link.
 *
 * `progress` is null while nothing runs; a button reads it to say "Exporting 200 / 456".
 */
export function useOrderExport() {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<OrderExportProgress | null>(null);

  const start = useCallback(
    async (args: OrderExportArgs) => {
      setProgress({ done: 0, total: 0 });

      try {
        const stream = orderClient.orderExport({
          teamId: args.teamId,
          filter: { status: args.status, ...orderListFilterMsg(args.filters) },
          view: args.view,
          orderIds: args.orderIds ?? [],
        });

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
          throw new Error(t("orders.export.noFile"));
        }

        download(url, filename);
        toaster.create({ type: "success", title: t("orders.export.ready") });
      } catch (err) {
        toaster.create({ type: "error", title: t("orders.export.failed"), description: rpcError(err) });
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

export { OrderExportView };
