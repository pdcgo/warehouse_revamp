import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Button, Flex, HStack, Icon, Spacer, Spinner, Span, Stack, Table, Tabs, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";

import { rpcError } from "../../api/clients";
import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useShipmentChannelsByIds } from "../../features/shipment/queries";
import { useWarehouseTransfers } from "../../features/warehouseTransfer/queries";
import { TRANSFER_STATUS_TABS, transferTab } from "../../features/warehouseTransfer/statusTabs";
import { problemUnits } from "../../features/warehouseTransfer/summary";
import { TransferItemsCell } from "../../features/warehouseTransfer/TransferItemsCell";
import { SellingTransferActions } from "../../features/warehouseTransfer/SellingTransferActions";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { WarehouseTransferStatusBadge } from "../../components/badges/WarehouseTransferStatusBadge";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import { TRANSFER_SELLING_PENDING } from "./pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// WarehouseTransferSellingPage — THE TEAM'S OWN TRANSFERS: stock it is moving between the warehouses that hold it
// (the-team-opens-the-sender-ships-the-receiver-accepts). It answers "where is my stock going, and has it got there":
//
//   - the ROUTE leads — from where to where, by warehouse NAME;
//   - the VALUE is the goods moved, filled by the system from A's batches (the-system-fills-a-transfers-prices), and
//     the shipping cost sits beside it, never inside (a-transfer-has-the-restocks-two-costs);
//   - units broken or missing at B are flagged on the row — the loss is the team's
//     (the-selling-team-bears-broken-missing-and-lost);
//   - each row's ⋯ offers what the status allows (SellingTransferActions holds the matrix).
//
// EVERY FILTER IS SERVER-SIDE — the list is paginated, so a client-side filter would narrow one page and lie in the
// pager.
export function WarehouseTransferSellingPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState(0n);

  const teamId = current?.teamId;
  const activeTab = transferTab(tab);

  const query = useWarehouseTransfers({
    teamId,
    status: activeTab.status,
    warehouseId: warehouseFilter,
    q: search,
    page,
    pageSize,
  });

  const transfers = query.data?.transfers ?? [];
  const actors = query.data?.actors;
  const teams = useTeamsByIds({ ids: transfers.flatMap((r) => [r.fromWarehouseId, r.toWarehouseId]) });
  const couriers = useShipmentChannelsByIds(transfers.map((r) => r.shipmentId));

  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const refreshing = query.isFetching && !query.isPending;
  const error = query.isError ? rpcError(query.error) : "";
  const filtered = search !== "" || warehouseFilter > 0n;

  // Any filter change restarts at page 1 — the page number belongs to the old question.
  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  const warehouseName = (id: bigint) =>
    teams.data?.[id.toString()]?.name || t("warehouseTransfer.warehouseRef", { id: id.toString() });

  function actorLabel(id: bigint): string {
    if (id === 0n) return "";
    const user = actors?.get(id.toString());

    return user ? user.name || user.username : t("warehouseTransfer.table.userRef", { id: id.toString() });
  }

  if (!current) {
    return (
      <Text color="fg.muted" data-testid="transfer-no-team">
        {t("warehouseTransfer.selectTeam")}
      </Text>
    );
  }

  return (
    <Stack gap="section">
      <NotImplementedSummary list={TRANSFER_SELLING_PENDING} />

      <Flex align="center" gap="card">
        <Spacer />
        <Button
          size="xs"
          colorPalette="brand"
          data-testid="open-create-transfer"
          onClick={() => navigate("/inventories/transfer/new")}
        >
          {t("warehouseTransfer.newTransfer")}
        </Button>
      </Flex>

      <FilterBar
        active={filtered}
        count={(search !== "" ? 1 : 0) + (warehouseFilter > 0n ? 1 : 0)}
        testId="transfer-filters"
        onClear={() =>
          refilter(() => {
            setSearch("");
            setWarehouseFilter(0n);
          })
        }
      >
        <FilterSearch
          value={search}
          onChange={(value) => refilter(() => setSearch(value))}
          placeholder={t("warehouseTransfer.searchPlaceholder")}
          testId="transfer-search"
        />
        {/* Either end — "everything going to or leaving Gudang Cabang". */}
        <FilterField w="15rem" testId="transfer-warehouse-filter">
          <TeamSelect
            value={warehouseFilter > 0n ? warehouseFilter : undefined}
            teamType={TeamType.WAREHOUSE}
            placeholder={t("warehouseTransfer.warehouseAll")}
            onChange={(id) => refilter(() => setWarehouseFilter(id))}
          />
        </FilterField>
      </FilterBar>

      <Tabs.Root value={tab} onValueChange={(e) => refilter(() => setTab(e.value))}>
        <Tabs.List overflowX="auto">
          {TRANSFER_STATUS_TABS.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} data-testid={`transfer-tab-${item.value}`}>
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <RefreshOverlay busy={refreshing}>
            <Stack gap="section">
              {error && (
                <Text color="error.fg" data-testid="transfers-error">
                  {error}
                </Text>
              )}

              {loading ? (
                <Spinner colorPalette="brand" />
              ) : (
                <Box overflowX="auto">
                  <Table.Root size="sm" data-testid="transfers-table">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>{t("warehouseTransfer.table.transfer")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseTransfer.table.route")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseTransfer.table.status")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseTransfer.table.products")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseTransfer.table.shipping")}</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">{t("warehouseTransfer.table.value")}</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">{t("warehouseTransfer.table.actions")}</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {transfers.map((transfer) => {
                        const problems = problemUnits(transfer);
                        const createdBy = actorLabel(transfer.createdByUserId);

                        return (
                          <Table.Row
                            key={transfer.id.toString()}
                            data-testid={`transfer-row-${transfer.id}`}
                            cursor="pointer"
                            _hover={{ bg: "bg.subtle" }}
                            onClick={() => navigate(`/inventories/transfer/${transfer.id}`)}
                          >
                            <Table.Cell>
                              <Stack gap="0">
                                <Span fontWeight="medium">#{transfer.id.toString()}</Span>
                                <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                                  {formatUnixDateTime(transfer.createdAtUnix)}
                                </Span>
                                {createdBy && (
                                  <Span fontSize="xs" color="fg.muted">
                                    {t("warehouseTransfer.table.by", { name: createdBy })}
                                  </Span>
                                )}
                              </Stack>
                            </Table.Cell>
                            <Table.Cell data-testid={`transfer-route-${transfer.id}`}>
                              <HStack gap="1.5" whiteSpace="nowrap">
                                <Span>{warehouseName(transfer.fromWarehouseId)}</Span>
                                <Icon as={ArrowRight} boxSize="3" color="fg.muted" />
                                <Span>{warehouseName(transfer.toWarehouseId)}</Span>
                              </HStack>
                            </Table.Cell>
                            <Table.Cell>
                              <Stack gap="1" align="start">
                                <WarehouseTransferStatusBadge status={transfer.status} />
                                {problems > 0n && (
                                  <Span fontSize="xs" color="warning.fg" data-testid={`transfer-problems-${transfer.id}`}>
                                    {t("warehouseTransfer.table.problemUnits", { count: Number(problems) })}
                                  </Span>
                                )}
                              </Stack>
                            </Table.Cell>
                            <Table.Cell>
                              <TransferItemsCell items={transfer.items} />
                            </Table.Cell>
                            <Table.Cell>
                              <Stack gap="0">
                                <ShipmentChannelBadge
                                  channelId={transfer.shipmentId}
                                  channel={couriers.data?.get(transfer.shipmentId.toString())}
                                />
                                <Span fontSize="xs" color="fg.muted" data-testid={`transfer-cost-${transfer.id}`}>
                                  {transfer.shipmentCost > 0n
                                    ? formatRupiah(transfer.shipmentCost)
                                    : t("warehouseTransfer.table.noCost")}
                                </Span>
                              </Stack>
                            </Table.Cell>
                            <Table.Cell textAlign="end" whiteSpace="nowrap" data-testid={`transfer-value-${transfer.id}`}>
                              {formatRupiah(transfer.total)}
                            </Table.Cell>
                            <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                              {teamId !== undefined && (
                                <SellingTransferActions
                                  transfer={transfer}
                                  teamId={teamId}
                                  variant="menu"
                                  pending={TRANSFER_SELLING_PENDING}
                                />
                              )}
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Root>
                </Box>
              )}

              {!loading && transfers.length === 0 && !error && (
                <Text color="fg.muted" data-testid="transfers-empty">
                  {activeTab.status === WarehouseTransferStatus.UNSPECIFIED
                    ? t("warehouseTransfer.empty")
                    : t("warehouseTransfer.emptyFiltered", { status: t(activeTab.labelKey).toLowerCase() })}
                </Text>
              )}

              {!loading && (
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
              )}
            </Stack>
          </RefreshOverlay>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
