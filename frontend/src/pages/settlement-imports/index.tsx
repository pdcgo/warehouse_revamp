import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  CloseButton,
  Flex,
  HStack,
  Heading,
  NativeSelect,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { rpcError } from "../../api/clients";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { useShopOptions } from "../../features/shops/queries";
import { UploadedFileStatusBadge } from "../../features/settlementImport/UploadedFileStatusBadge";
import { useUploadedFiles } from "../../features/settlementImport/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useActors } from "../../features/users/queries";
import { UploadedFileStatus } from "../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { ImportFileDialog } from "./components/ImportFileDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// "" = every status. The rest are the statuses a person filters by.
const STATUS_FILTERS: { value: string; statuses: UploadedFileStatus[]; label: string }[] = [
  { value: "", statuses: [], label: "settlementImports.filter.allStatuses" },
  { value: "running", statuses: [UploadedFileStatus.RUNNING], label: "settlementImports.status.running" },
  { value: "interrupted", statuses: [UploadedFileStatus.INTERRUPTED], label: "settlementImports.status.interrupted" },
  { value: "done", statuses: [UploadedFileStatus.DONE], label: "settlementImports.status.done" },
  { value: "failed", statuses: [UploadedFileStatus.FAILED], label: "settlementImports.status.failed" },
];

// SettlementImportsPage — the platform statements a selling team has imported, and the way in for
// the next one. Design: docs/business/settlement/settlement_importer_decision.md.
//
// Mounted at /settlement/imports, offered to CS and up on a selling team (cs-and-up-import-daily).
//
// The rules this screen carries:
//  - one row per UPLOAD — the same file twice is two rows (the-row-key-is-the-only-dedupe);
//  - a running row keeps climbing on its own, whoever started it (an-import-finishes-whether-anyone-watches);
//  - an interrupted row says how to finish it: upload the same file again;
//  - nothing here undoes an import (an-upload-is-never-reverted) — a row opens the file's own page.
export function SettlementImportsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { current } = useTeam();
  const teamId = current?.teamId;

  const [shopId, setShopId] = useState(0n);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const statuses = STATUS_FILTERS.find((f) => f.value === status)?.statuses ?? [];
  const query = useUploadedFiles({ teamId, shopId, statuses, page, pageSize });
  const files = query.data?.files ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  const shops = useShopOptions({ teamId: teamId ?? 0n });
  const shopById = useMemo(() => new Map((shops.data ?? []).map((s) => [s.id.toString(), s])), [shops.data]);
  const actors = useActors(files.map((f) => f.createdByUserId));

  if (!teamId) return null;

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Stack gap="0">
          <Heading size="md">{t("settlementImports.title")}</Heading>
          <Text fontSize="sm" color="fg.muted">
            {t("settlementImports.subtitle")}
          </Text>
        </Stack>
        <Spacer />
        <ImportFileDialog teamId={teamId} />
      </Flex>

      <Flex gap="card" wrap="wrap" align="center">
        <HStack maxW="xs" flex="1" minW="56" gap="1" data-testid="imports-shop-filter">
          <ShopSelect
            teamId={teamId}
            value={shopId}
            placeholder={t("settlementImports.filter.allShops")}
            onChange={(id) => {
              setPage(1);
              setShopId(id);
            }}
          />
          {shopId > 0n && (
            <CloseButton
              size="xs"
              aria-label={t("settlementImports.filter.clearShop")}
              onClick={() => {
                setPage(1);
                setShopId(0n);
              }}
            />
          )}
        </HStack>

        <NativeSelect.Root maxW="48">
          <NativeSelect.Field
            value={status}
            data-testid="imports-status-filter"
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {t(f.label)}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="imports-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <RefreshOverlay busy={query.isFetching && !query.isPending}>
          <Table.ScrollArea>
            <Table.Root size="sm" interactive data-testid="imports-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("settlementImports.col.shop")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("settlementImports.col.period")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("settlementImports.col.uploaded")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("settlementImports.col.status")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("settlementImports.tally.posted")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("settlementImports.tally.existing")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("settlementImports.tally.held")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("settlementImports.tally.skipped")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {files.map((file) => {
                  const shop = shopById.get(file.shopId.toString());
                  const uploader = actors.data?.get(file.createdByUserId.toString())?.name;

                  return (
                    <Table.Row
                      key={file.id.toString()}
                      cursor="pointer"
                      data-testid={`import-row-${file.id}`}
                      onClick={() => navigate(`/settlement/imports/${file.id}`)}
                    >
                      <Table.Cell>
                        <HStack gap="2">
                          <Text>{shop?.name ?? `#${file.shopId}`}</Text>
                          <MarketplaceBadge marketplace={file.platform} size="sm" />
                        </HStack>
                      </Table.Cell>
                      <Table.Cell color={file.periodFrom ? undefined : "fg.muted"}>
                        {file.periodFrom ? `${file.periodFrom} – ${file.periodTo}` : "—"}
                      </Table.Cell>
                      <Table.Cell>
                        <Text>{uploader ?? `#${file.createdByUserId}`}</Text>
                        <Text fontSize="xs" color="fg.muted">
                          {file.createdAt ? timestampDate(file.createdAt).toLocaleString() : "—"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Stack gap="0.5" align="start">
                          <UploadedFileStatusBadge status={file.status} />
                          {file.status === UploadedFileStatus.INTERRUPTED && (
                            <Text fontSize="xs" color="fg.muted" data-testid={`import-hint-${file.id}`}>
                              {t("settlementImports.interruptedHint")}
                            </Text>
                          )}
                          {file.status === UploadedFileStatus.FAILED && file.failure && (
                            <Text fontSize="xs" color="red.fg" maxW="xs" truncate>
                              {file.failure}
                            </Text>
                          )}
                        </Stack>
                      </Table.Cell>
                      <Table.Cell textAlign="end">{file.tally?.posted ?? 0}</Table.Cell>
                      <Table.Cell textAlign="end">{file.tally?.existing ?? 0}</Table.Cell>
                      <Table.Cell textAlign="end" color={file.tally?.held ? "orange.fg" : undefined}>
                        {file.tally?.held ?? 0}
                      </Table.Cell>
                      <Table.Cell textAlign="end">{file.tally?.skipped ?? 0}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </RefreshOverlay>
      )}

      {!loading && files.length === 0 && !error && (
        <Text color="fg.muted" data-testid="imports-empty">
          {t("settlementImports.empty")}
        </Text>
      )}

      <Pagination
        count={totalItems}
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
