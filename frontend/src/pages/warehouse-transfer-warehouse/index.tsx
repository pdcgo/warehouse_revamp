import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Flex, SegmentGroup, Spinner, Span, Stack, Table, Tabs, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import {
  WarehouseTransferDirection,
  WarehouseTransferStatus,
} from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useShipmentChannelsByIds } from "../../features/shipment/queries";
import { useWarehouseTransfers } from "../../features/warehouseTransfer/queries";
import { TRANSFER_STATUS_TABS, transferTab } from "../../features/warehouseTransfer/statusTabs";
import { TransferItemsCell } from "../../features/warehouseTransfer/TransferItemsCell";
import { WarehouseTransferActions } from "../../features/warehouseTransfer/WarehouseTransferActions";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { WarehouseTransferStatusBadge } from "../../components/badges/WarehouseTransferStatusBadge";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { TeamItem } from "../../components/entity/TeamItem";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { formatUnixDateTime } from "../../lib/datetime";
import { TRANSFER_WAREHOUSE_PENDING } from "./pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

type Direction = "outgoing" | "incoming";

const DIRECTION: Record<Direction, WarehouseTransferDirection> = {
  outgoing: WarehouseTransferDirection.OUTGOING,
  incoming: WarehouseTransferDirection.INCOMING,
};

// WarehouseTransferWarehousePage — A WAREHOUSE'S TRANSFER QUEUE. A warehouse is A for the transfers leaving it and B
// for those coming to it, and those are two different jobs — picking and shipping, or signing and counting — so the
// two directions are two views, never one mixed list (the-team-opens-the-sender-ships-the-receiver-accepts):
//
//   Outgoing — what to pick and send: Process, then Ship.
//   Incoming — what is coming, or at the door: Sign, then Accept. B sees a transfer from the moment it is opened, so it
//              can plan rack space for it.
//
// The goods belong to a selling team, so the crew sees NO values here — counting is its job, prices are not its
// business. The row's buttons are the next act this side can do (WarehouseTransferActions holds the matrix).
export function WarehouseTransferWarehousePage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [direction, setDirection] = useState<Direction>("outgoing");
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState(0n);
  const [otherFilter, setOtherFilter] = useState(0n);

  const teamId = current?.teamId;
  const activeTab = transferTab(tab);

  const query = useWarehouseTransfers({
    teamId,
    status: activeTab.status,
    direction: DIRECTION[direction],
    ownerTeamId: ownerFilter,
    warehouseId: otherFilter,
    q: search,
    page,
    pageSize,
  });

  const transfers = query.data?.transfers ?? [];
  const teams = useTeamsByIds({
    ids: transfers.flatMap((r) => [r.teamId, r.fromWarehouseId, r.toWarehouseId]),
  });
  const couriers = useShipmentChannelsByIds(transfers.map((r) => r.shipmentId));

  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const refreshing = query.isFetching && !query.isPending;
  const error = query.isError ? rpcError(query.error) : "";
  const filterCount = (search !== "" ? 1 : 0) + (ownerFilter > 0n ? 1 : 0) + (otherFilter > 0n ? 1 : 0);

  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  const teamOf = (id: bigint) => {
    const found = teams.data?.[id.toString()];

    return { teamId: id, teamName: found?.name, teamType: found?.type, imageUrl: found?.imageUrl };
  };

  if (!current || teamId === undefined) {
    return (
      <Text color="fg.muted" data-testid="transfer-no-team">
        {t("warehouseTransfer.selectTeam")}
      </Text>
    );
  }

  return (
    <Stack gap="section">
      <NotImplementedSummary list={TRANSFER_WAREHOUSE_PENDING} />

      <Flex>
        <SegmentGroup.Root
          value={direction}
          onValueChange={(e) => refilter(() => setDirection((e.value as Direction | null) ?? direction))}
          aria-label={t("warehouseTransfer.direction.label")}
          data-testid="transfer-direction"
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Item value="outgoing" data-testid="transfer-direction-outgoing">
            <SegmentGroup.ItemText>{t("warehouseTransfer.direction.outgoing")}</SegmentGroup.ItemText>
            <SegmentGroup.ItemHiddenInput />
          </SegmentGroup.Item>
          <SegmentGroup.Item value="incoming" data-testid="transfer-direction-incoming">
            <SegmentGroup.ItemText>{t("warehouseTransfer.direction.incoming")}</SegmentGroup.ItemText>
            <SegmentGroup.ItemHiddenInput />
          </SegmentGroup.Item>
        </SegmentGroup.Root>
      </Flex>

      <FilterBar
        active={filterCount > 0}
        count={filterCount}
        testId="transfer-filters"
        onClear={() =>
          refilter(() => {
            setSearch("");
            setOwnerFilter(0n);
            setOtherFilter(0n);
          })
        }
      >
        <FilterSearch
          value={search}
          onChange={(value) => refilter(() => setSearch(value))}
          placeholder={t("warehouseTransfer.searchPlaceholder")}
          testId="transfer-search"
        />
        {/* WHOSE GOODS — the selling team. A search select: sellers grow with the business. */}
        <FilterField w="15rem" testId="transfer-owner-filter">
          <TeamSelect
            value={ownerFilter > 0n ? ownerFilter : undefined}
            teamType={TeamType.SELLING}
            placeholder={t("warehouseTransfer.ownerAll")}
            onChange={(id) => refilter(() => setOwnerFilter(id))}
          />
        </FilterField>
        {/* THE OTHER END — where it is going, or coming from. */}
        <FilterField w="15rem" testId="transfer-other-filter">
          <TeamSelect
            value={otherFilter > 0n ? otherFilter : undefined}
            teamType={TeamType.WAREHOUSE}
            excludeTeamIds={[teamId]}
            placeholder={
              direction === "outgoing" ? t("warehouseTransfer.toAll") : t("warehouseTransfer.fromAll")
            }
            onChange={(id) => refilter(() => setOtherFilter(id))}
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
                        <Table.ColumnHeader>{t("warehouseTransfer.table.owner")}</Table.ColumnHeader>
                        <Table.ColumnHeader>
                          {direction === "outgoing" ? t("warehouseTransfer.table.to") : t("warehouseTransfer.table.from")}
                        </Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseTransfer.table.status")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseTransfer.table.products")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseTransfer.table.parcel")}</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">{t("warehouseTransfer.table.actions")}</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {transfers.map((transfer) => {
                        const other = direction === "outgoing" ? transfer.toWarehouseId : transfer.fromWarehouseId;

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
                              </Stack>
                            </Table.Cell>
                            <Table.Cell minW="48" data-testid={`transfer-owner-${transfer.id}`}>
                              <TeamItem team={teamOf(transfer.teamId)} />
                            </Table.Cell>
                            <Table.Cell minW="48" data-testid={`transfer-other-${transfer.id}`}>
                              <TeamItem team={teamOf(other)} />
                            </Table.Cell>
                            <Table.Cell>
                              <WarehouseTransferStatusBadge status={transfer.status} />
                            </Table.Cell>
                            <Table.Cell>
                              <TransferItemsCell items={transfer.items} showPrices={false} />
                            </Table.Cell>
                            <Table.Cell>
                              <Stack gap="0">
                                <ShipmentChannelBadge
                                  channelId={transfer.shipmentId}
                                  channel={couriers.data?.get(transfer.shipmentId.toString())}
                                />
                                {transfer.receipt && (
                                  <Span fontSize="xs" color="fg.muted">
                                    {transfer.receipt}
                                  </Span>
                                )}
                              </Stack>
                            </Table.Cell>
                            <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                              <WarehouseTransferActions
                                transfer={transfer}
                                teamId={teamId}
                                variant="row"
                                pending={TRANSFER_WAREHOUSE_PENDING}
                              />
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
                    ? t(direction === "outgoing" ? "warehouseTransfer.emptyOutgoing" : "warehouseTransfer.emptyIncoming")
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
