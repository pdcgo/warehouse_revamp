import { useEffect, useMemo, useState } from "react";
import { personName } from "../../lib/users";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  Flex,
  HStack,
  Heading,
  Icon,
  Link,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Download, Rows3 } from "lucide-react";
import { documentClient, rpcError } from "../../api/clients";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { CompactActions } from "../../components/chrome/CompactActions";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { formatDayShort, formatUnixDateTime } from "../../lib/datetime";
import { LineBlock } from "./components/LineBlock";
import { useIsMobile } from "../../layouts/shell";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { useShopOptions } from "../../features/shops/queries";
import { FileTally } from "../../features/settlementImport/FileTally";
import { UploadedFileStatusBadge } from "../../features/settlementImport/UploadedFileStatusBadge";
import { type LineView, useUploadedFile, useUploadedFileLines } from "../../features/settlementImport/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useActors } from "../../features/users/queries";
import { ActorName } from "../../components/entity/ActorName";
import { SettlementType } from "../../gen/warehouse/settlement/v1/settlement_pb";
import {
  type UploadedFile,
  type UploadedFileLine,
  UploadedFileLineOutcome,
  UploadedFileLineReason,
  UploadedFileStatus,
} from "../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { formatRupiah } from "../../lib/money";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// The order a row's money went to, linked under its result: a row that posted, or was already there, with no reason.
// A row posted to the shop (NO_ORDER, SEVERAL_ORDERS) keeps its own reason and the orders it found, as accepted.
function orderOf(line: UploadedFileLine): bigint {
  const landed = line.outcome === UploadedFileLineOutcome.POSTED || line.outcome === UploadedFileLineOutcome.EXISTING;
  return landed && line.reason === UploadedFileLineReason.UNSPECIFIED ? line.orderId : 0n;
}

const REASON: Record<UploadedFileLineReason, string> = {
  [UploadedFileLineReason.UNSPECIFIED]: "settlementImports.reason.unspecified",
  [UploadedFileLineReason.NO_ORDER]: "settlementImports.reason.noOrder",
  [UploadedFileLineReason.UNMAPPED_TYPE]: "settlementImports.reason.unmappedType",
  [UploadedFileLineReason.FRACTIONAL_AMOUNT]: "settlementImports.reason.fractionalAmount",
  [UploadedFileLineReason.REFUSED]: "settlementImports.reason.refused",
  [UploadedFileLineReason.REPEATS_ORDER_DETAILS]: "settlementImports.reason.repeatsOrderDetails",
  [UploadedFileLineReason.FAILED_WITHDRAWAL]: "settlementImports.reason.failedWithdrawal",
  [UploadedFileLineReason.SEVERAL_ORDERS]: "settlementImports.reason.severalOrders",
};

// What each view tells the person to do about its rows.
const VIEW_NOTE: Record<LineView, string> = {
  held: "settlementImports.detail.heldNote",
  skipped: "settlementImports.detail.skippedNote",
  toShop: "settlementImports.detail.toShopNote",
  posted: "settlementImports.detail.postedNote",
  existing: "settlementImports.detail.existingNote",
};

// The views in their tab order: the three a person acts on or reads first, as accepted, then every posted row and
// every row already there — so each row of the file is shown with its result (acceptance *open import detail*).
const VIEWS: readonly LineView[] = ["held", "skipped", "toShop", "posted", "existing"];

// SettlementImportDetailPage — one imported statement: what it posted, and each of its rows with what
// became of it. Design: docs/business/settlement/settlement_importer_decision.md.
//
// Mounted at /settlement/imports/:fileId, reached by clicking a row of the list (a detail view is a
// page, not a dialog).
//
// The rules this screen carries:
//  - three views of the rows worth a look — HELD (the same file again posts them once fixed), SKIPPED
//    (by decision) and POSTED TO THE SHOP (their order was not found, or their ref is on several live orders —
//    each of those named, a link to the order, so a person can place the money:
//    two-live-orders-on-a-ref-post-to-the-shop);
//  - then every POSTED row (each with the order it went to, a link — or the shop) and every row ALREADY THERE, so each
//    row of the file is shown with its result (the owner's acceptance row *open import detail*, backlog #93). Each view
//    pages on the server: a statement runs to thousands of rows;
//  - the original is downloadable, through a signed URL minted when asked;
//  - there is NO Revert and NO Reprocess (an-upload-is-never-reverted, the-row-key-is-the-only-dedupe);
//  - ON A PHONE (below `md`, a JS breakpoint — never CSS hiding) it draws its own arrangement, as accepted
//    (the-import-detail-phone-prototype-is-accepted): the title row with Download as its icon, the tabs on one sliding
//    row, each row a block (./components/LineBlock.tsx) that opens nothing but its order links
//    (a-phone-import-block-opens-only-its-order-link), each tab's note kept (the-import-pages-tab-note-stays-on-a-phone).
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
        // THE FIRST LOAD IS THE PAGE'S SHAPE — a title bar and rows, never a spinner on an empty page
        // (motion-is-small-quick-and-shared), on both shells.
        <ListSkeleton heading testId="import-detail-loading" />
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
  // A PHONE GETS ITS OWN ARRANGEMENT (the-import-detail-phone-prototype-is-accepted) — one breakpoint read in JS, so
  // exactly one of the two layouts mounts and every test id is on the page once.
  const phone = useIsMobile();

  const [view, setView] = useState<LineView>("held");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [downloading, setDownloading] = useState(false);

  const shops = useShopOptions({ teamId });
  const shop = useMemo(() => (shops.data ?? []).find((s) => s.id === file.shopId), [shops.data, file.shopId]);
  const actors = useActors([file.createdByUserId]);
  const uploader = personName(actors.data?.get(file.createdByUserId.toString()), `#${file.createdByUserId}`);
  // When it was uploaded, in the app's language and in WIB — the full form, as a detail page keeps it
  // (a-table-date-is-short-and-every-time-is-wib).
  const uploadedAt = file.createdAt ? formatUnixDateTime(file.createdAt.seconds) : "—";

  const lines = useUploadedFileLines({ teamId, fileId: file.id, view, page, pageSize });
  const rows = lines.data?.lines ?? [];

  // ANOTHER TAB NEVER SHOWS THE PREVIOUS TAB'S ROWS (the-import-detail-phone-prototype-is-accepted — on both shells).
  // A list keeps its previous answer while the next one loads (`listQuery`'s placeholder) — right for the next PAGE or
  // page size of the same tab (the rows stay, under RefreshOverlay), wrong for another TAB: that is a different subject
  // (HARD RULE 10), and Held's rows must never stand under the Posted tab. So a tab shows its skeleton until its own
  // rows land.
  const [readFor, setReadFor] = useState<LineView>(view);
  useEffect(() => {
    if (lines.data && !lines.isPlaceholderData) setReadFor(view);
  }, [lines.data, lines.isPlaceholderData, view]);
  const firstLoadOfView = lines.isPending || (lines.isPlaceholderData && readFor !== view);

  // What became of a row, in the "Why" column. A row with a reason says it, as accepted; a row that posted, or was
  // already there, with no reason says where its money is — its order (linked under it) or the shop.
  const resultOf = (line: UploadedFileLine) => {
    if (line.reason !== UploadedFileLineReason.UNSPECIFIED) return t(REASON[line.reason]);
    if (line.outcome === UploadedFileLineOutcome.POSTED) {
      return line.orderId > 0n
        ? t("settlementImports.result.postedToOrder")
        : t("settlementImports.result.postedToShop");
    }
    if (line.outcome === UploadedFileLineOutcome.EXISTING) return t("settlementImports.result.existing");
    return t(REASON[UploadedFileLineReason.UNSPECIFIED]);
  };

  const counts: Record<LineView, number> = {
    held: file.tally?.held ?? 0,
    skipped: file.tally?.skipped ?? 0,
    toShop: file.tally?.postedToShop ?? 0,
    posted: file.tally?.posted ?? 0,
    existing: file.tally?.existing ?? 0,
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
      {phone ? (
        // ON A PHONE the title row holds the shop and, at its end, Download as its icon
        // (a-phone-header-action-is-an-icon — one action → its icon, never a row of its own); the badges wrap after the
        // name, which is never clamped (a-phone-reads-each-line-as-a-block: names at full width).
        <Stack gap="1" data-testid="import-detail-header" data-layout="phone">
          <Flex align="start" gap="2" minW="0">
            <Flex flex="1" minW="0" align="center" columnGap="2" rowGap="1" wrap="wrap">
              <Heading size="md" wordBreak="break-word" data-testid="import-detail-shop">
                {shop?.name ?? `#${file.shopId}`}
              </Heading>
              <MarketplaceBadge marketplace={file.platform} size="sm" />
              <UploadedFileStatusBadge status={file.status} />
            </Flex>
            <CompactActions
              menuLabel={t("common.actions")}
              actions={[
                file.documentId !== "" && {
                  id: "download",
                  label: t("settlementImports.detail.download"),
                  icon: Download,
                  testId: "download-original",
                  disabled: downloading,
                  onClick: () => void downloadOriginal(),
                },
              ]}
            />
          </Flex>
          <Text fontSize="sm" color="fg.muted" data-testid="import-detail-period">
            {file.periodFrom
              ? t("settlementImports.detail.period", { from: file.periodFrom, to: file.periodTo })
              : t("settlementImports.detail.periodUnread")}
          </Text>
          <Text fontSize="sm" color="fg.muted" wordBreak="break-word" data-testid="import-detail-uploaded-by">
            <ActorName
              name={t("settlementImports.detail.uploadedBy", { name: uploader, at: uploadedAt })}
              isOverride={file.isOverride}
            />
          </Text>
        </Stack>
      ) : (
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
            <Text fontSize="sm" color="fg.muted" data-testid="import-detail-uploaded-by">
              {/* The uploader, with the "by Root team" badge when Root uploaded it from outside the team. */}
              <ActorName
                name={t("settlementImports.detail.uploadedBy", { name: uploader, at: uploadedAt })}
                isOverride={file.isOverride}
              />
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
      )}

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
        {/* ON A PHONE the five tabs sit on ONE row that slides sideways, no bar drawn, a tab never shrinks
            (nothing-runs-past-a-phones-edge — the transfer lists' row, the-transfer-lists-read-as-blocks-on-a-phone);
            overflowY hidden, or an `auto` x makes y auto too and draws a stray vertical bar. */}
        <Tabs.List
          {...(phone
            ? { overflowX: "auto", overflowY: "hidden", flexWrap: "nowrap", css: { scrollbarWidth: "none" } }
            : {})}
        >
          {VIEWS.map((v) => (
            <Tabs.Trigger
              key={v}
              value={v}
              flexShrink={phone ? 0 : undefined}
              data-testid={`lines-tab-${v}`}
            >
              {t(`settlementImports.detail.view.${v}`, { count: counts[v] })}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      {/* Each tab's note, on every tab and on both shells — wrapped whole on a phone, never cut or hidden
          (the-import-pages-tab-note-stays-on-a-phone). */}
      <Text fontSize="sm" color="fg.muted" data-testid="lines-note">
        {t(VIEW_NOTE[view])}
      </Text>

      {lines.isError && (
        <Text color="red.fg" data-testid="lines-error">
          {rpcError(lines.error)}
        </Text>
      )}

      {/* A tab's first load is its shape, never a spinner (motion-is-small-quick-and-shared); a tab with no rows shows
          the empty hint where the rows would be — its title the sentence the page said before, its test id kept
          (an-empty-list-shows-a-hint); the next page keeps the rows on screen under RefreshOverlay (HARD RULE 10).
          Both shells. */}
      {firstLoadOfView ? (
        !lines.isError && <ListSkeleton rows={phone ? 4 : 5} testId="lines-loading" />
      ) : rows.length === 0 ? (
        !lines.isError && (
          <EmptyHint icon={Rows3} size="sm" title={t("settlementImports.detail.noLines")} testId="lines-empty" />
        )
      ) : (
        <RefreshOverlay busy={lines.isFetching && !lines.isPending}>
          {phone ? (
            // ON A PHONE each row is a BLOCK (a-phone-reads-each-line-as-a-block, as the transfer lists:
            // the-transfer-lists-read-as-blocks-on-a-phone) that opens nothing but its order links
            // (a-phone-import-block-opens-only-its-order-link).
            <Stack gap="3" data-testid="lines-table" data-layout="phone">
              {rows.map((line) => (
                <LineBlock key={line.id.toString()} line={line} result={resultOf(line)} orderId={orderOf(line)} />
              ))}
            </Stack>
          ) : (
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
                      {/* The statement's day, short — *27 Sep*, the year only when it is not this year, in the app's
                          language (a-table-date-is-short-and-every-time-is-wib). */}
                      <Table.Cell whiteSpace="nowrap">{formatDayShort(line.occurredOn)}</Table.Cell>
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
                        <Text data-testid={`line-reason-${line.id}`}>{resultOf(line)}</Text>
                        {orderOf(line) > 0n && (
                          <HStack gap="2" wrap="wrap" fontSize="xs">
                            <Link asChild colorPalette="primary" fontFamily="mono">
                              <RouterLink to={`/orders/${line.orderId}`} data-testid={`line-order-${line.id}`}>
                                #{line.orderId.toString()}
                              </RouterLink>
                            </Link>
                          </HStack>
                        )}
                        {line.foundOrderIds.length > 0 && (
                          <HStack gap="2" wrap="wrap" fontSize="xs" data-testid={`line-found-orders-${line.id}`}>
                            {line.foundOrderIds.map((orderId) => (
                              <Link key={orderId.toString()} asChild colorPalette="primary" fontFamily="mono">
                                <RouterLink
                                  to={`/orders/${orderId}`}
                                  data-testid={`line-found-order-${line.id}-${orderId}`}
                                >
                                  #{orderId.toString()}
                                </RouterLink>
                              </Link>
                            ))}
                          </HStack>
                        )}
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
          )}
        </RefreshOverlay>
      )}

      {/* ONE growing pager for both shells, always on screen (every-list-pages-with-the-growing-pager,
          the-pager-is-always-on-screen): the desktop keeps its 10 / 20 / 50 per page on the left; on a phone the
          buttons are centred and the per-page selector is not drawn — GrowingPager does that itself
          (a-phone-pager-is-centred-without-a-page-size). A new tab or page size starts the trail over. */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={lines.isPlaceholderData ? undefined : page * pageSize < (lines.data?.totalItems ?? 0)}
        resetKey={`${view}|${pageSize}`}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="lines-pager"
      />
    </Stack>
  );
}
