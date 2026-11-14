import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Button, Flex, Heading, SegmentGroup, Spinner, Span, Stack, Table, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeftRight, SearchX } from "lucide-react";

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
import { useIsMobile } from "../../layouts/shell";
import { WarehouseTransferBlock } from "./components/WarehouseTransferBlock";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { personName } from "../../lib/users";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { WarehouseTransferStatusBadge } from "../../components/badges/WarehouseTransferStatusBadge";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { TeamItem } from "../../components/entity/TeamItem";
import { RootTeamBadge } from "../../components/entity/ActorName";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { idCodec, oneOfCodec, textCodec, useUrlState } from "../../lib/urlState";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

type Direction = "outgoing" | "incoming";

const DIRECTION: Record<Direction, WarehouseTransferDirection> = {
  outgoing: WarehouseTransferDirection.OUTGOING,
  incoming: WarehouseTransferDirection.INCOMING,
};

// The direction and the status tab as the URL carries them — only what this list offers is read back.
const DIRECTION_CODEC = oneOfCodec<Direction>(["outgoing", "incoming"]);
const STATUS_CODEC = oneOfCodec(TRANSFER_STATUS_TABS.map((item) => item.value));

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
  // A PHONE GETS ITS OWN ARRANGEMENT (the-transfer-lists-read-as-blocks-on-a-phone) — below `md`, a JS breakpoint, never
  // CSS hiding: the title, the tabs on one sliding row, a block per transfer with its next act named at its foot.
  const phone = useIsMobile();

  // THE DIRECTION, THE FILTERS AND THE STATUS TAB LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh, or Back
  // from a transfer, opens the same queue: the direction narrows the one transfer list as the tabs do. The page number
  // stays on screen only.
  const [direction, setDirection] = useUrlState<Direction>("direction", "outgoing", DIRECTION_CODEC);
  const [tab, setTab] = useUrlState("status", "all", STATUS_CODEC);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useUrlState("q", "", textCodec);
  const [ownerFilter, setOwnerFilter] = useUrlState("owner", 0n, idCodec);
  const [otherFilter, setOtherFilter] = useUrlState("warehouse", 0n, idCodec);

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

  // Who opened it — under the owning team on both shells (the-transfer-lists-read-as-blocks-on-a-phone, as the restock
  // inbound row does: the-inbound-row-says-who-and-when). 0 is "not recorded", and the honest answer there is nothing.
  function actorLabel(id: bigint): string {
    if (id === 0n) return "";
    const user = query.data?.actors?.get(id.toString());

    return personName(user, t("warehouseTransfer.table.userRef", { id: id.toString() }));
  }

  const nameOf = (id: bigint) =>
    teams.data?.[id.toString()]?.name || t("warehouseTransfer.warehouseRef", { id: id.toString() });

  // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint), on both shells, where the rows would be; the title keeps
  // the sentence the list said before, and its test id. Nothing matches — on any tab, All too: clear the filters (the
  // strip's Clear and the hint's are one function); an empty tab: which status has none; nothing yet: where transfers
  // come from — no action, a warehouse opens none (a-warehouse-asks-the-team-to-open-a-transfer).
  function emptyHint() {
    if (filterCount > 0) {
      return (
        <EmptyHint
          icon={SearchX}
          title={t("warehouseTransfer.none")}
          description={t("emptyHint.noMatch")}
          action={
            <Button
              variant="outline"
              colorPalette="gray"
              data-testid="transfers-empty-clear"
              onClick={() =>
                refilter(() => {
                  setSearch("");
                  setOwnerFilter(0n);
                  setOtherFilter(0n);
                })
              }
            >
              {t("common.clearFilters")}
            </Button>
          }
          testId="transfers-empty"
        />
      );
    }

    const wholeList = activeTab.status === WarehouseTransferStatus.UNSPECIFIED;

    return (
      <EmptyHint
        icon={ArrowLeftRight}
        title={
          wholeList
            ? t(direction === "outgoing" ? "warehouseTransfer.emptyOutgoing" : "warehouseTransfer.emptyIncoming")
            : t("warehouseTransfer.emptyFiltered", { status: t(activeTab.labelKey).toLowerCase() })
        }
        description={
          wholeList
            ? t(direction === "outgoing" ? "warehouseTransfer.emptyOutgoingHint" : "warehouseTransfer.emptyIncomingHint")
            : undefined
        }
        testId="transfers-empty"
      />
    );
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

      {/* ON A PHONE THE PAGE NAMES ITSELF (the-phone-shell-has-no-top-bar, every-phone-title-is-20px). */}
      {phone && (
        <Heading size="md" data-layout="phone">
          {t("nav.warehouseTransfer")}
        </Heading>
      )}

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
        {/* On a phone the row slides sideways, a tab never shrinks and no bar is drawn under it
            (the-transfer-lists-read-as-blocks-on-a-phone, nothing-runs-past-a-phones-edge) — Team Balance's row. */}
        {/* overflowY hidden on both: an `auto` x makes y `auto` too, and the selected tab's line then draws a stray
            vertical scrollbar at the row's end on a desktop. */}
        <Tabs.List
          overflowX="auto"
          overflowY="hidden"
          {...(phone ? { flexWrap: "nowrap", css: { scrollbarWidth: "none" } } : {})}
        >
          {TRANSFER_STATUS_TABS.map((item) => (
            <Tabs.Trigger
              key={item.value}
              value={item.value}
              flexShrink={phone ? 0 : undefined}
              data-testid={`transfer-tab-${item.value}`}
            >
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
              ) : transfers.length === 0 ? (
                !error && emptyHint()
              ) : phone ? (
                // A PHONE READS EACH TRANSFER AS A BLOCK (a-phone-reads-each-line-as-a-block) — the restock inbound's.
                <Stack gap="3" data-testid="transfers-table" data-layout="phone">
                  {transfers.map((transfer) => (
                    <WarehouseTransferBlock
                      key={transfer.id.toString()}
                      transfer={transfer}
                      teamId={teamId}
                      direction={direction}
                      ownerName={nameOf(transfer.teamId)}
                      otherName={nameOf(direction === "outgoing" ? transfer.toWarehouseId : transfer.fromWarehouseId)}
                      createdBy={actorLabel(transfer.createdByUserId)}
                      courier={couriers.data?.get(transfer.shipmentId.toString())}
                      onOpen={() => navigate(`/inventories/transfer/${transfer.id}`)}
                    />
                  ))}
                </Stack>
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
                                  {formatUnixDateTimeShort(transfer.createdAtUnix)}
                                </Span>
                              </Stack>
                            </Table.Cell>
                            {/* WHOSE GOODS, THEN WHO OPENED IT, SMALL UNDER IT — the restock inbound row's From cell
                                (the-inbound-row-says-who-and-when): one context, two lines, so the team is its small
                                one-line item and the person sits under its name, with the "by Root team" badge after
                                them when Root opened it from outside the team (an-override-shows-a-platform-badge). */}
                            <Table.Cell minW="48" data-testid={`transfer-owner-${transfer.id}`}>
                              <Stack gap="0" minW="0">
                                <TeamItem team={teamOf(transfer.teamId)} size="xs" />
                                {createdBy && (
                                  <Span
                                    fontSize="xs"
                                    color="fg.muted"
                                    whiteSpace="nowrap"
                                    // past TeamItem's 2xs avatar and its gap: under the team's name
                                    ps="calc({sizes.6} + {spacing.1.5})"
                                    data-testid={`transfer-created-by-${transfer.id}`}
                                  >
                                    {t("warehouseTransfer.table.by", { name: createdBy })}
                                    {transfer.createdByIsOverride && <RootTeamBadge size="xs" ms="1.5" />}
                                  </Span>
                                )}
                              </Stack>
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
                              />
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Root>
                </Box>
              )}

              {/* THE PAGES GROW AS THEY ARE OPENED, and the pager is always on screen — on a phone centred with no page
                  size, which GrowingPager does itself (every-list-pages-with-the-growing-pager,
                  a-phone-pager-is-centred-without-a-page-size, the-pager-is-always-on-screen). */}
              {!loading && (
                <GrowingPager
                  page={page}
                  onPageChange={setPage}
                  hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
                  resetKey={[direction, tab, search, ownerFilter, otherFilter, pageSize].join("|")}
                  pageSize={pageSize}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageSizeChange={(n) => {
                    setPageSize(n);
                    setPage(1);
                  }}
                  testId="transfer-pager"
                />
              )}
            </Stack>
          </RefreshOverlay>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
