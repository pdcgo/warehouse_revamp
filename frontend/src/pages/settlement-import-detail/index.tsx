import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  Flex,
  HStack,
  Heading,
  Icon,
  Spinner,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ArrowLeft, Download } from "lucide-react";
import { documentClient, rpcError } from "../../api/clients";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { useShopOptions } from "../../features/shops/queries";
import { FileTally } from "../../features/settlementImport/FileTally";
import { UploadedFileStatusBadge } from "../../features/settlementImport/UploadedFileStatusBadge";
import { type LineView, useUploadedFile, useUploadedFileLines } from "../../features/settlementImport/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useActors } from "../../features/users/queries";
import { SettlementType } from "../../gen/warehouse/settlement/v1/settlement_pb";
import {
  type UploadedFile,
  UploadedFileLineOutcome,
  UploadedFileLineReason,
  UploadedFileStatus,
} from "../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { formatRupiah } from "../../lib/money";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const REASON: Record<UploadedFileLineReason, string> = {
  [UploadedFileLineReason.UNSPECIFIED]: "settlementImports.reason.unspecified",
  [UploadedFileLineReason.NO_ORDER]: "settlementImports.reason.noOrder",
  [UploadedFileLineReason.UNMAPPED_TYPE]: "settlementImports.reason.unmappedType",
  [UploadedFileLineReason.FRACTIONAL_AMOUNT]: "settlementImports.reason.fractionalAmount",
  [UploadedFileLineReason.REFUSED]: "settlementImports.reason.refused",
  [UploadedFileLineReason.REPEATS_ORDER_DETAILS]: "settlementImports.reason.repeatsOrderDetails",
  [UploadedFileLineReason.FAILED_WITHDRAWAL]: "settlementImports.reason.failedWithdrawal",
};

// What each view tells the person to do about its rows.
const VIEW_NOTE: Record<LineView, string> = {
  held: "settlementImports.detail.heldNote",
  skipped: "settlementImports.detail.skippedNote",
  toShop: "settlementImports.detail.toShopNote",
};

// SettlementImportDetailPage — one imported statement: what it posted, and every row that did not
// simply post to its order. Design: docs/business/settlement/settlement_importer_decision.md.
//
// Mounted at /settlement/imports/:fileId, reached by clicking a row of the list (a detail view is a
// page, not a dialog).
//
// The rules this screen carries:
//  - three views of the rows worth a look — HELD (the same file again posts them once fixed), SKIPPED
//    (by decision) and POSTED TO THE SHOP (their order was not found);
//  - the original is downloadable, through a signed URL minted when asked;
//  - there is NO Revert and NO Reprocess (an-upload-is-never-reverted, the-row-key-is-the-only-dedupe).
export function SettlementImportDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { fileId: fileIdParam } = useParams();
  const { current } = useTeam();
  const teamId = current?.teamId;

  const fileId = (() => {
    try {
      return BigInt(fileIdParam ?? "0");
    } catch {
      return 0n;
    }
  })();

  const query = useUploadedFile({ teamId, fileId });
  const file = query.data;

  return (
    <Stack gap="section">
      <Box>
        <Button
          size="xs"
          variant="ghost"
          data-testid="back-to-imports"
          onClick={() => navigate("/settlement/imports")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("settlementImports.title")}
        </Button>
      </Box>

      {query.isPending ? (
        <Spinner colorPalette="brand" />
      ) : query.isError ? (
        <Text color="red.fg" data-testid="import-detail-error">
          {rpcError(query.error)}
        </Text>
      ) : !file ? (
        <Text color="fg.muted" data-testid="import-detail-not-found">
          {t("settlementImports.detail.notFound")}
        </Text>
      ) : (
        <FileDetail teamId={teamId!} file={file} />
      )}
    </Stack>
  );
}

function FileDetail({ teamId, file }: { teamId: bigint; file: UploadedFile }) {
  const { t } = useTranslation();

  const [view, setView] = useState<LineView>("held");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [downloading, setDownloading] = useState(false);

  const shops = useShopOptions({ teamId });
  const shop = useMemo(() => (shops.data ?? []).find((s) => s.id === file.shopId), [shops.data, file.shopId]);
  const actors = useActors([file.createdByUserId]);
  const uploader = actors.data?.get(file.createdByUserId.toString())?.name ?? `#${file.createdByUserId}`;

  const lines = useUploadedFileLines({ teamId, fileId: file.id, view, page, pageSize });
  const rows = lines.data?.lines ?? [];

  const counts: Record<LineView, number> = {
    held: file.tally?.held ?? 0,
    skipped: file.tally?.skipped ?? 0,
    toShop: file.tally?.postedToShop ?? 0,
  };

  // The URL is minted when somebody asks for it — a signed link resolved on page load would quietly
  // expire while the page sat open.
  async function downloadOriginal() {
    setDownloading(true);
    try {
      const res = await documentClient.getDownloadUrl({ teamId, documentId: file.documentId });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Stack gap="section">
      <Flex align="start" gap="card" wrap="wrap">
        <Stack gap="1">
          <HStack gap="2">
            <Heading size="md" data-testid="import-detail-shop">
              {shop?.name ?? `#${file.shopId}`}
            </Heading>
            <MarketplaceBadge marketplace={file.platform} size="sm" />
            <UploadedFileStatusBadge status={file.status} />
          </HStack>
          <Text fontSize="sm" color="fg.muted" data-testid="import-detail-period">
            {file.periodFrom
              ? t("settlementImports.detail.period", { from: file.periodFrom, to: file.periodTo })
              : t("settlementImports.detail.periodUnread")}
          </Text>
          <Text fontSize="sm" color="fg.muted">
            {t("settlementImports.detail.uploadedBy", {
              name: uploader,
              at: file.createdAt ? timestampDate(file.createdAt).toLocaleString() : "—",
            })}
          </Text>
        </Stack>
        <Box flex="1" />
        {file.documentId && (
          <Button
            size="xs"
            variant="outline"
            loading={downloading}
            data-testid="download-original"
            onClick={() => void downloadOriginal()}
          >
            <Icon as={Download} boxSize="4" />
            {t("settlementImports.detail.download")}
          </Button>
        )}
      </Flex>

      {file.status === UploadedFileStatus.FAILED && (
        <Box borderWidth="1px" borderColor="red.muted" rounded="md" p="3" data-testid="import-detail-failure">
          <Text fontWeight="medium" color="red.fg">
            {t("settlementImports.detail.failed")}
          </Text>
          <Text fontSize="sm" color="red.fg">
            {file.failure}
          </Text>
        </Box>
      )}

      {file.status === UploadedFileStatus.INTERRUPTED && (
        <Text fontSize="sm" color="orange.fg" data-testid="import-detail-interrupted">
          {t("settlementImports.interruptedHint")}
        </Text>
      )}

      <Card.Root>
        <Card.Body>
          <FileTally tally={file.tally} />
        </Card.Body>
      </Card.Root>

      <Tabs.Root
        value={view}
        onValueChange={(e) => {
          setView(e.value as LineView);
          setPage(1);
        }}
      >
        <Tabs.List>
          {(["held", "skipped", "toShop"] as const).map((v) => (
            <Tabs.Trigger key={v} value={v} data-testid={`lines-tab-${v}`}>
              {t(`settlementImports.detail.view.${v}`, { count: counts[v] })}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      <Text fontSize="sm" color="fg.muted" data-testid="lines-note">
        {t(VIEW_NOTE[view])}
      </Text>

      {lines.isError && (
        <Text color="red.fg" data-testid="lines-error">
          {rpcError(lines.error)}
        </Text>
      )}

      {lines.isPending ? (
        <Spinner colorPalette="brand" />
      ) : (
        <RefreshOverlay busy={lines.isFetching && !lines.isPending}>
          <Table.ScrollArea>
            <Table.Root size="sm" data-testid="lines-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("settlementImports.line.date")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("settlementImports.line.orderRef")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("settlementImports.line.platformType")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("settlementImports.line.becomes")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("settlementImports.line.amount")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("settlementImports.line.reason")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((line) => (
                  <Table.Row key={line.id.toString()} data-testid={`line-row-${line.id}`}>
                    <Table.Cell whiteSpace="nowrap">{line.occurredOn}</Table.Cell>
                    <Table.Cell fontFamily="mono">{line.orderRef || "—"}</Table.Cell>
                    <Table.Cell>
                      <Text>{line.platformType}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        {line.sheet}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {/* A skipped row is never recorded, so it has no "becomes" — not "not mapped". */}
                      {line.outcome === UploadedFileLineOutcome.SKIPPED
                        ? "—"
                        : line.settlementType === SettlementType.UNSPECIFIED
                          ? t("settlementImports.line.unmapped")
                          : t(`settlementImports.type.${SettlementType[line.settlementType].toLowerCase()}`)}
                    </Table.Cell>
                    <Table.Cell textAlign="end" whiteSpace="nowrap" color={line.change < 0n ? "red.fg" : undefined}>
                      {formatRupiah(line.change)}
                    </Table.Cell>
                    <Table.Cell>
                      <Text data-testid={`line-reason-${line.id}`}>{t(REASON[line.reason])}</Text>
                      {line.detail && (
                        <Text fontSize="xs" color="fg.muted">
                          {line.detail}
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </RefreshOverlay>
      )}

      {!lines.isPending && rows.length === 0 && !lines.isError && (
        <Text color="fg.muted" data-testid="lines-empty">
          {t("settlementImports.detail.noLines")}
        </Text>
      )}

      <Pagination
        count={lines.data?.totalItems ?? 0}
        pageSize={pageSize}
        page={page}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </Stack>
  );
}
