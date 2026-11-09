import { useCallback, useEffect, useRef, useState } from "react";

import { orderClient, rpcError } from "../../../api/clients";
import { useInvalidateOrders } from "../../../features/orders/queries";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { OrderImportLogLevel } from "../../../gen/warehouse/selling/v1/order_pb";
import type { OrderImportLevel, OrderImportResult } from "./OrderImportLog";

// The platforms an order export can be read from (the-order-import-is-one-rpc-per-platform). The platform picks the RPC;
// any other marketplace is offered in the grid and told "not yet" at the next step.
export const ORDER_IMPORT_MARKETPLACES: readonly Marketplace[] = [Marketplace.SHOPEE, Marketplace.TIKTOK];

export function canImportOrdersFrom(marketplace: Marketplace | undefined): boolean {
  return marketplace !== undefined && ORDER_IMPORT_MARKETPLACES.includes(marketplace);
}

// The server's ceiling (the request's `max_len`), checked here too so an oversized file is refused before it is sent.
export const MAX_ORDER_FILE_BYTES = 10 * 1024 * 1024;

const LEVEL: Partial<Record<OrderImportLogLevel, OrderImportLevel>> = {
  [OrderImportLogLevel.WARN]: "warn",
  [OrderImportLogLevel.ERROR]: "error",
};

/**
 * Runs ONE order import and folds its stream into what OrderImportLog draws. Every message is a leveled line; the
 * step, the count and the tally ride along as they become known, so the bar and the counts are read from fields —
 * never out of the text.
 *
 * Closing the dialog drops the stream, never the import: the server finishes the file whether anyone watches.
 */
export function useOrderImport() {
  const [result, setResult] = useState<OrderImportResult | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const invalidate = useInvalidateOrders();

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (args: { teamId: bigint; shopId: bigint; marketplace: Marketplace; file: File }) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setResult({ phase: "running", step: 0, count: 0, lines: [] });

      try {
        const request = {
          teamId: args.teamId,
          shopId: args.shopId,
          fileContent: new Uint8Array(await args.file.arrayBuffer()),
        };
        const stream =
          args.marketplace === Marketplace.TIKTOK
            ? orderClient.tiktokOrderImport(request, { signal: abort.signal })
            : orderClient.shopeeOrderImport(request, { signal: abort.signal });

        let failed = false;

        for await (const msg of stream) {
          const level = LEVEL[msg.level] ?? "info";
          failed ||= level === "error";

          setResult((r) => ({
            phase: "running",
            step: msg.step || (r?.step ?? 0),
            count: msg.count || (r?.count ?? 0),
            tally: msg.tally ?? r?.tally,
            lines: [...(r?.lines ?? []), { level, message: msg.message }],
          }));
        }

        // An ERROR line ends the import before any order is touched — the shop, or the file.
        setResult((r) => r && { ...r, phase: failed ? "failed" : "done" });
      } catch (err) {
        if (abort.signal.aborted) return;

        setResult((r) => ({
          phase: "failed",
          step: r?.step ?? 0,
          count: r?.count ?? 0,
          tally: r?.tally,
          lines: [...(r?.lines ?? []), { level: "error", message: rpcError(err) }],
        }));
      } finally {
        void invalidate();
      }
    },
    [invalidate],
  );

  // The dialog closed or went back: stop listening. The import itself carries on.
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setResult(undefined);
  }, []);

  return { result, start, reset };
}
