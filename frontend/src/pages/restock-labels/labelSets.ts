import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";

import { restockClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import type { RestockLabel, RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import {
  RestockLabelSchema,
  RestockRequestByIdsDataType,
  RestockRequestStatus,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";

// ONE RESTOCK'S LABELS — what Cetak Label holds for each restock on it (labels-print-several-restocks).
//
//   loading       its restock is not in yet
//   error         the read failed, or the restock is not this warehouse's to read (unknown, or another's)
//   notPrintable  neither Tiba nor Diterima — it has no labels, and says so
//   ready         its labels:
//                   Diterima — the server's, one per placement, the product code in the QR
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

/** What one restock's part of the read carried — the restock, and an accepted one's labels. */
interface Answered {
  restock: RestockRequest | null;
  labels: RestockLabel[] | null;
  excludedCount: bigint;
}

/**
 * Every restock's labels, in the order given — read in ONE call (owner: *"restock detail harusnya ada yang dipanggil
 * ids"*, the-labels-mark-their-one-by-one-read): `RestockRequestByIds` with the restock and, for an accepted one, its
 * labels, where the page used to ask RestockRequestDetail and RestockRequestLabels for each restock (5 restocks were up to
 * 10 calls, 50 up to 100). A restock put on the print is a new set of ids, so the read runs again; the restocks already on
 * it keep their answer meanwhile (`listQuery` — the same print, refined) and the new one loads in its own row.
 */
export function useLabelSets(teamId: bigint | undefined, ids: bigint[]): LabelSet[] {
  const query = useQuery({
    ...listQuery,
    queryKey: key.restock(teamId, { labelSets: ids.join(",") }),
    enabled: teamId !== undefined && ids.length > 0,
    queryFn: async () => {
      const res = await restockClient.restockRequestByIds({
        teamId: teamId!,
        filter: { ids },
        dataRequest: [RestockRequestByIdsDataType.RESTOCK_REQUEST, RestockRequestByIdsDataType.LABELS],
      });

      const answered = new Map<string, Answered>();
      for (const [id, list] of Object.entries(res.items)) {
        const one: Answered = { restock: null, labels: null, excludedCount: 0n };
        for (const item of list.items) {
          if (item.d.case === "restockRequest") one.restock = item.d.value;
          if (item.d.case === "labels") {
            one.labels = item.d.value.labels;
            one.excludedCount = item.d.value.excludedCount;
          }
        }
        answered.set(id, one);
      }

      return answered;
    },
  });

  return useMemo(
    () =>
      ids.map((id): LabelSet => {
        const base = { id, restock: null, error: null, arrived: false, labels: [], excludedCount: 0n };
        const one = query.data?.get(id.toString());

        if (!one) {
          // Not in the answer: still on its way (the first read, or a restock just put on while the others' answer is
          // kept), the read failed, or the restock is not this warehouse's — absent, as the server never confirms it.
          if (query.isError) return { ...base, state: "error", error: query.error };
          if (query.isPending || query.isPlaceholderData) return { ...base, state: "loading" };
          return { ...base, state: "error" };
        }

        const restock = one.restock;
        if (!restock) return { ...base, state: "error" };
        if (!isPrintable(restock.status)) return { ...base, restock, state: "notPrintable" };
        if (restock.status === RestockRequestStatus.ARRIVED) {
          return { ...base, restock, state: "ready", arrived: true, labels: arrivedLabels(restock) };
        }
        // An accepted restock's labels travel with it in the same answer — none is a restock that could not be read whole.
        if (!one.labels) return { ...base, restock, state: "error" };

        return { ...base, restock, state: "ready", labels: one.labels, excludedCount: one.excludedCount };
      }),
    // The ids and the read's answer are the whole input; the query object itself is new on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(","), query.data, query.status, query.isPlaceholderData, query.error],
  );
}
