import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";

import type { RestockLabel, RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockLabelSchema, RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { restockLabelsQuery, restockRequestQuery } from "../../features/restock/queries";

// ONE RESTOCK'S LABELS — what Cetak Label holds for each restock on it (labels-print-several-restocks).
//
//   loading       its detail is not in yet
//   error         its detail, or an accepted one's labels, could not be read
//   notPrintable  neither Tiba nor Diterima — it has no labels, and says so
//   ready         its labels:
//                   Diterima — the server's, one per placement, its batch in the QR
//                   Tiba     — its own lines, one per product, as many as ordered, no placement, no batch
//                            (labels-print-from-arrived)
export interface LabelSet {
  id: bigint;
  state: "loading" | "error" | "notPrintable" | "ready";
  restock: RestockRequest | null;
  error: unknown;
  arrived: boolean;
  labels: RestockLabel[];
  /** Broken and missing units of an accepted restock — they never became stock, so they have no label. */
  excludedCount: bigint;
}

export const isPrintable = (status: RestockRequestStatus) =>
  status === RestockRequestStatus.ACCEPTED || status === RestockRequestStatus.ARRIVED;

/** An arrived restock's labels — its lines as they are, before anything is counted or placed. */
function arrivedLabels(restock: RestockRequest): RestockLabel[] {
  return restock.items.map((item) =>
    create(RestockLabelSchema, {
      productId: item.productId,
      productCode: item.productCode,
      name: item.name,
      quantity: item.count,
      placementCode: "",
      batchId: 0n,
    }),
  );
}

/**
 * Every restock's labels, in the order given. Each restock is the same two questions a single Cetak Label asks — its
 * detail, then (accepted only) its labels — asked through `useQueries` with the shared options, so a restock added to
 * the page is read once and the ones already on it stay as they are while it loads.
 */
export function useLabelSets(teamId: bigint | undefined, ids: bigint[]): LabelSet[] {
  const details = useQueries({ queries: ids.map((id) => restockRequestQuery(teamId, id)) });
  const labelReads = useQueries({
    queries: ids.map((id, i) => {
      const options = restockLabelsQuery(teamId, id);
      return { ...options, enabled: options.enabled && details[i]?.data?.status === RestockRequestStatus.ACCEPTED };
    }),
  });

  // Rebuilt only when an answer changes — every read's `data` and `status` in one key.
  const signature = [...details, ...labelReads].map((q) => `${q.status}:${q.dataUpdatedAt}`).join("|");

  return useMemo(
    () =>
      ids.map((id, i): LabelSet => {
        const detail = details[i];
        const labels = labelReads[i];
        const restock = detail?.data ?? null;
        const base = { id, restock, error: null, arrived: false, labels: [], excludedCount: 0n };

        if (detail?.isError) return { ...base, state: "error", error: detail.error };
        if (!restock) return { ...base, state: detail?.isPending ? "loading" : "error" };
        if (!isPrintable(restock.status)) return { ...base, state: "notPrintable" };
        if (restock.status === RestockRequestStatus.ARRIVED) {
          return { ...base, state: "ready", arrived: true, labels: arrivedLabels(restock) };
        }
        if (labels?.isError) return { ...base, state: "error", error: labels.error };
        if (!labels?.data) return { ...base, state: "loading" };

        return { ...base, state: "ready", labels: labels.data.labels, excludedCount: labels.data.excludedCount };
      }),
    // `signature` stands for every read's answer; the arrays themselves are new on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(","), signature],
  );
}
