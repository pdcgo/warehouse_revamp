import { useQuery, useQueryClient } from "@tanstack/react-query";
import { settlementImporterClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import {
  UploadedFileLineOutcome,
  UploadedFileLineReason,
  UploadedFileStatus,
} from "../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { fileByIdsRowData, fileListRowData, filesFromByIds, filesFromList, lineListRowData, linesFromList } from "./adapt";

// The platform statements a selling team imports — docs/business/settlement/settlement_importer.md.
//
// Every read is scoped to the team (cs-and-up-import-daily), so the team is in every key.

// While a file on the page is still RUNNING, the list re-asks every few seconds so its tallies climb
// without anyone reloading. A running import is the one row whose answer changes while nobody acts —
// the tab that started it may already be closed (an-import-finishes-whether-anyone-watches).
const RUNNING_REFRESH_MS = 5_000;

// The import screen's list, newest upload first.
export function useUploadedFiles(args: {
  teamId: bigint | undefined;
  shopId: bigint;
  statuses: UploadedFileStatus[];
  page: number;
  pageSize: number;
}) {
  const { teamId, shopId, statuses, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.settlementImports(teamId, {
      list: true,
      shopId: shopId.toString(),
      statuses: statuses.join(","),
      page,
      pageSize,
    }),
    enabled: teamId !== undefined,
    refetchInterval: (query) =>
      query.state.data?.files.some((f) => f.status === UploadedFileStatus.RUNNING) ? RUNNING_REFRESH_MS : false,
    queryFn: async () => {
      const res = await settlementImporterClient.uploadedFileList({
        teamId: teamId!,
        filter: { shopId, statuses },
        dataRequest: fileListRowData(),
        page: { page, limit: pageSize },
      });

      return {
        files: filesFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// One file, for its own page. `null` when the id is not this team's — the page says "not found"
// rather than showing another team's statement.
export function useUploadedFile(args: { teamId: bigint | undefined; fileId: bigint }) {
  const { teamId, fileId } = args;

  return useQuery({
    queryKey: key.settlementImports(teamId, { fileId: fileId.toString() }),
    enabled: teamId !== undefined && fileId > 0n,
    refetchInterval: (query) => (query.state.data?.status === UploadedFileStatus.RUNNING ? RUNNING_REFRESH_MS : false),
    queryFn: async () => {
      const res = await settlementImporterClient.uploadedFileByIds({
        teamId: teamId!,
        filter: { ids: [fileId] },
        dataRequest: fileByIdsRowData(),
      });

      return filesFromByIds(res).get(fileId.toString()) ?? null;
    },
  });
}

// The file page's three views of what did not simply post to its order.
export type LineView = "held" | "skipped" | "toShop";

const LINE_FILTER: Record<LineView, { outcomes: UploadedFileLineOutcome[]; reasons: UploadedFileLineReason[] }> = {
  held: { outcomes: [UploadedFileLineOutcome.HELD], reasons: [] },
  skipped: { outcomes: [UploadedFileLineOutcome.SKIPPED], reasons: [] },
  // Posted — but to the shop, because the order its ref names was not found (an-unmatched-ref-posts-to-the-shop).
  toShop: { outcomes: [UploadedFileLineOutcome.POSTED], reasons: [UploadedFileLineReason.NO_ORDER] },
};

export function useUploadedFileLines(args: {
  teamId: bigint | undefined;
  fileId: bigint;
  view: LineView;
  page: number;
  pageSize: number;
}) {
  const { teamId, fileId, view, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.settlementImports(teamId, { lines: fileId.toString(), view, page, pageSize }),
    enabled: teamId !== undefined && fileId > 0n,
    queryFn: async () => {
      const res = await settlementImporterClient.uploadedFileLineList({
        teamId: teamId!,
        filter: { uploadedFileId: fileId, ...LINE_FILTER[view] },
        dataRequest: lineListRowData(),
        page: { page, limit: pageSize },
      });

      return {
        lines: linesFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// An import that ends — or is left to finish on its own — changes the list, the file's page and its
// lines. One prefix covers all three.
export function useInvalidateUploadedFiles() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["settlementImports"] });
}
