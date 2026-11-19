import { restockClient } from "../../api/clients";
import type { RestockDateField, RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useFileExport } from "../../lib/useFileExport";

// THE SELLING RESTOCK LIST AS A FILE (the-restock-list-exports-and-filters-by-courier, on one-export-is-the-list-as-a-file
// and a-report-export-is-the-whole-view-as-a-file): RestockRequestExport with the list's OWN filter — the tab's status,
// the warehouse, the courier, the tags (any of), who raised and who accepted it, the date window and the settled search —
// so the file holds
// exactly the rows the list holds, every page of them, in the screen's columns (a Tag column after Status, #87), .xlsx,
// streamed with progress, then downloaded.

/** What the list was asked with — the same fields useRestockRequests sends, without its page. */
export interface RestockExportFilter {
  status: RestockRequestStatus;
  warehouseId: bigint;
  createdByUserId: bigint;
  acceptedByUserId: bigint;
  shipmentId: bigint;
  dateField: RestockDateField;
  fromUnix: bigint;
  toUnix: bigint;
  q: string;
  /** Empty = any tag; else ANY of them — the list's Tag filter (#87). */
  tagIds: bigint[];
}

export function useRestockExport(teamId: bigint | undefined) {
  const exporter = useFileExport();

  const start = (filter: RestockExportFilter) =>
    teamId === undefined ? Promise.resolve() : exporter.start(restockClient.restockRequestExport({ teamId, filter }));

  return { ...exporter, start };
}
