import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Button, Collapsible, Flex, HStack, Heading, Icon, Span, Stack, Table, Tabs, Text } from "@chakra-ui/react";
import { ClipboardList, Download, Plus, SearchX, Warehouse } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import {
  RestockActorRole,
  RestockDateField,
  RestockRequestStatus,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import type { Team } from "../../gen/warehouse/team/v1/team_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { useShipmentChannelsByIds } from "../../features/shipment/queries";
import { useRestockPeople, useRestockRequests } from "../../features/restock/queries";
import { useFinancialAccountOptions } from "../../features/financialAccount/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { LineSupplier, useLineSuppliers } from "../../features/restock/LineSupplier";
import type { LineSupplierProps } from "../../features/restock/LineSupplier";
import { RestockItemsCell } from "../../features/restock/RestockItemsCell";
import { RESTOCK_STATUS_TABS, restockTab } from "../../features/restock/statusTabs";
import { RESTOCK_DATE_FIELDS } from "../../features/restock/dateFields";
import { committedValue, shortfall } from "../../features/restock/summary";
import { SellingRestockActions } from "../../features/restock/SellingRestockActions";
import { ALL_DATES, DateRangePicker, isAllDates, resolveRange } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { CompactActions } from "../../components/chrome/CompactActions";
import { CopyText } from "../../components/chrome/CopyText";
import { StatsToggle } from "../../components/chrome/StatsToggle";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { TeamItem } from "../../components/entity/TeamItem";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { PersonFilterSelect } from "../../components/pickers/PersonFilterSelect";
import { ShipmentChannelSelect } from "../../components/pickers/ShipmentChannelSelect";
import { toaster } from "../../components/feedback/Toaster";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { PRESSABLE } from "../../lib/motion";
import { useDebounced } from "../../lib/useDebounced";
import { dateRangeCodec, enumCodec, idCodec, oneOfCodec, textCodec, useUrlState } from "../../lib/urlState";
import { PaymentBreakdown } from "./components/PaymentBreakdown";
import { RestockSummary } from "./components/RestockSummary";
import { RESTOCK_SELLING_PENDING } from "./pending";
import { type RestockPile, samplePaymentSplit, sampleRestockSummary } from "./summarySample";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up) — set on the cells, by Chakra's `_hover`,
// which a story can drive with `data-hover`.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// The status tab and the date type as the URL carries them — only a tab, or a date, this list offers is read back.
const STATUS_CODEC = oneOfCodec(RESTOCK_STATUS_TABS.map((item) => item.value));
const DATE_FIELD_CODEC = enumCodec(RESTOCK_DATE_FIELDS.map((f) => f.value));

// How many names to resolve for the id columns. A page of restocks can only name as many warehouses
// and suppliers as it has rows, so one modest read covers every page-size the pager offers.
const NAME_LOOKUP_SIZE = 200;

// The three dates a restock has now live in features/restock/dateFields.ts — the warehouse list
// offers the same segment, and a restock has the same three dates on either screen (#224/#163).

// RestockSellingPage — the RESTOCK LIST AS A BUYER SEES IT (#105).
//
// This was one screen shared with the warehouse (#122) until the two jobs were pulled apart, and the
// split is the point: a warehouse is looking at an inbound work queue ("what has landed that I have
// to count and shelve"), while a selling team is looking at PURCHASING — what it has bought, what it
// has committed money to, and whether it got what it paid for. The columns follow from that:
//
//   - the SUPPLIER leads, because buying is organised by who you bought from — read off the LINES now, since a
//     line names the store it was bought from (a-line-names-the-channel-it-was-bought-from);
//   - the DESTINATION is a warehouse NAME, not "warehouse #3" — an id is not somewhere goods go;
//   - the VALUE is on the row — goods plus shipping, what the paying account was charged, and NEVER the courier's
//     charge at the door, which the warehouse paid and is owed back on its own (the-couriers-charge-stays-out-of-total);
//   - MISSING units are flagged in the list, not only on the detail page (a-short-unit-at-the-door-is-missing). The
//     gap is what someone chases the supplier about, and a discrepancy nobody scrolls to is one nobody chases;
//   - each row's ⋯ offers what the status allows — Edit · Cancel · Mark Lost while ongoing, Edit Lines once arrived
//     (SellingRestockActions holds the matrix).
//
// No "Requested by" column: every row on this screen was raised by the team reading it — RestockRequestList returns
// `requesting_team_id = team` OR `warehouse_id = team`, and a selling team is never a warehouse target. No team badge
// or blurb either (owner): the switcher names the team. The page's own TITLE is back — it leaned on the breadcrumb,
// and the shell has none now (the-desktop-shell-has-no-top-bar).
//
// THE SCREEN RULES (context_decision.md, applied when the owner opened this screen: *"inisiasi dulu"*):
//
//   Restok                                                        [+ Restok Baru]
//   [⌕ Cari restok, resi, faktur, atau SKU] [Semua gudang ⌄] [Siapa saja yang membuat ⌄] [… menerima ⌄] [Dibuat · …]
//   Semua Status · Dalam Perjalanan · Tiba · Diterima · Hilang · Dibatalkan       [📊 Statistik ⌄]   ← picked tab bold
//   (opened: RestockSummary for the tab, under the row)          on a phone: [⌕ Cari …] [Filter] [📊]
//   Referensi              Pemasok  Gudang  Produk  Total  Pengiriman  Status  Dibuat        Diterima  Aksi
//   Faktur INV/…/1001 ⧉    …                                               29 Okt 13:05  —         ⋯
//   Resi JNE01234567… ⧉                                                    oleh Rina      ← two lines, never three
//                                       ‹ [1] ›                    ← the growing pager, always on screen
//
// On a phone the filters are a sheet, New Restock is its ＋, and each restock is a block.
//
// EVERY FILTER IS SERVER-SIDE, and that is not an implementation detail. The list is paginated, so a
// filter applied here would narrow the loaded page only — while `totalItems` went on counting the
// unfiltered set and the pager confidently offered pages that no longer existed.
export function RestockSellingPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // THE FILTERS AND THE STATUS TAB LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh, or Back from a
  // restock, opens the same narrowed list. The page number stays on screen only.
  const [tab, setTab] = useUrlState("status", "all", STATUS_CODEC);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [search, setSearch] = useUrlState("q", "", textCodec);
  const [warehouseFilter, setWarehouseFilter] = useUrlState("warehouse", 0n, idCodec);
  // 0 = anybody. Two ids, not one: see the pickers below for why the two sides are separate filters.
  const [createdByFilter, setCreatedByFilter] = useUrlState("creator", 0n, idCodec);
  const [acceptedByFilter, setAcceptedByFilter] = useUrlState("acceptor", 0n, idCodec);
  // The courier — held on screen and thrown away (`dropped`): the list cannot ask for it yet. 0n = any courier.
  const [courierFilter, setCourierFilter] = useUrlState("courier", 0n, idCodec);
  const [range, setRange] = useUrlState<DateRange>("range", ALL_DATES, dateRangeCodec);
  const [dateField, setDateField] = useUrlState<RestockDateField>("date", RestockDateField.CREATED, DATE_FIELD_CODEC);

  // Typed, then settled — a word is one request to the server, not one per key.
  const term = useDebounced(search.trim());

  const teamId = current?.teamId;

  // The tab IS the status filter: it decides the `status` the RPC gets, and nothing else. Keeping the
  // tab (a string, what Tabs speaks) as the state and deriving the rest from it means the status the
  // server filters on and the label the empty state names can never drift apart.
  const activeTab = restockTab(tab);
  const status = activeTab.status;

  const { fromUnix, toUnix } = resolveRange(range);

  const query = useRestockRequests({
    teamId,
    status,
    warehouseId: warehouseFilter,
    createdByUserId: createdByFilter,
    acceptedByUserId: acceptedByFilter,
    dateField,
    fromUnix,
    toUnix,
    q: term,
    page,
    pageSize,
  });

  // Whether the statistics are open — page state only, shut on every visit.
  const [statsOpen, setStatsOpen] = useState(false);

  // The two "who" filters' people — everyone on this team's restocks who raised one, and who accepted one.
  const createdBy = useRestockPeople({ teamId, role: RestockActorRole.CREATED });
  const acceptedBy = useRestockPeople({ teamId, role: RestockActorRole.ACCEPTED });

  // The two id → name lookups this screen's columns need: the list RPC's GENERAL slice carries the
  // RESTOCK's own name, not its supplier's or its destination's. The warehouses are an ordinary paged list
  // read once and turned into a map, the same way the products screen resolves them.
  const warehouses = useTeams({
    teamType: TeamType.WAREHOUSE,
    page: 1,
    pageSize: NAME_LOOKUP_SIZE,
    reference: true,
  });
  // WHERE EACH ROW WAS BOUGHT — the lines' suppliers and stores, resolved by id for every line on this page in two
  // reads (useLineSuppliers). By id, never from this team's list: a line may name another team's supplier
  // (a-line-connects-to-any-teams-supplier-from-a-popup), or a deleted one, still named and badged
  // (a-deleted-supplier-still-shows-with-a-badge).
  const pageLines = useMemo(() => (query.data?.requests ?? []).flatMap((r) => r.items), [query.data]);
  const { suppliers, channels: stores } = useLineSuppliers(teamId, pageLines);
  // The couriers — a restock names a shipment channel by id; one read for the page.
  const couriers = useShipmentChannelsByIds((query.data?.requests ?? []).map((r) => r.shipmentId));

  // Keyed to the whole TEAM, not just its name: the Destination cell renders the shared TeamItem
  // (owner), which wants the avatar and the type badge as well.
  const warehouseTeams = useMemo(() => {
    const out: Record<string, Team> = {};
    for (const team of warehouses.data?.teams ?? []) out[team.id.toString()] = team;
    return out;
  }, [warehouses.data]);

  const requests = query.data?.requests ?? [];
  const actors = query.data?.actors;
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  // Always-fresh means every tab, page and filter change refetches; `listQuery` keeps the rows that
  // are already up while it does, and RefreshOverlay is what says so. `isPending` is excluded — a
  // first load has nothing to keep and shows the skeleton instead.
  const refreshing = query.isFetching && !query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // How many filters narrow the list — the phone's Filter count, and what puts Hapus Filter on screen. The date type
  // alone narrows nothing: it says which date a range is about. The courier counts though the rows do not move for it,
  // so Clear is there to take it back.
  const filtering =
    (search.trim() !== "" ? 1 : 0) +
    (warehouseFilter !== 0n ? 1 : 0) +
    (courierFilter !== 0n ? 1 : 0) +
    (createdByFilter !== 0n ? 1 : 0) +
    (acceptedByFilter !== 0n ? 1 : 0) +
    (isAllDates(range) ? 0 : 1);
  // What the rows on screen were asked with, which is what "nothing matches" is about.
  const narrowed =
    term !== "" || warehouseFilter !== 0n || createdByFilter !== 0n || acceptedByFilter !== 0n || !isAllDates(range);

  // Any change to a filter restarts at page 1 — the page number belongs to the OLD question, and
  // page 5 of "All Status" is very likely past the end of "Cancelled".
  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  // Every filter back to its start — the strip's Clear and a no-match hint's, one function. The tab stays: it is the
  // status being read, not a filter laid over it.
  const clearFilters = () =>
    refilter(() => {
      setSearch("");
      setWarehouseFilter(0n);
      setCourierFilter(0n);
      setCreatedByFilter(0n);
      setAcceptedByFilter(0n);
      setRange(ALL_DATES);
      setDateField(RestockDateField.CREATED);
    });

  const newRestock = () => navigate("/inventories/restock/new");
  // EXPORT (owner: *"restok ada … export"*) — the list as a file, as the order list's. Nothing makes the file yet
  // (`dropped`): the click says so rather than doing nothing.
  const exportList = () => toaster.create({ type: "info", title: t("restock.selling.exportPending") });
  const open = (request: RestockRequest) => navigate(`/inventories/restock/${request.id}`);

  // Who did it. 0 is "not recorded" — every restock raised before the actor columns existed, and the
  // honest answer there is nothing rather than a name we would have to invent.
  function actorLabel(id: bigint): string {
    if (id === 0n) return "";
    // A NAME here, not the whole person: a table cell has room for "by Rina" and nothing more. The
    // avatar the same read carries is what the detail page's timeline renders instead.
    const user = actors?.get(id.toString());

    return user ? user.name || user.username : t("restock.table.userRef", { id: id.toString() });
  }

  // When it was raised and BY WHOM — one line, under the number it belongs to. Date AND TIME (owner): several restocks
  // are raised in one morning, and the day alone cannot put them in order for the person who raised them.
  function raised(request: RestockRequest) {
    const by = actorLabel(request.createdByUserId);

    return (
      <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap">
        {formatUnixDateTimeShort(request.createdAtUnix)}
        {by && (
          <Span data-testid={`restock-created-by-${request.id}`}>
            {" · "}
            {t("restock.table.by", { name: by })}
          </Span>
        )}
      </Span>
    );
  }

  // A date cell: when, then by whom under it — two lines, one event. A dash until it happens.
  function whenBy(unix: bigint, userId: bigint, testId: string) {
    if (unix <= 0n) return <Span color="fg.muted">—</Span>;
    const by = actorLabel(userId);

    return (
      <Stack gap="0">
        <Span fontSize="xs" whiteSpace="nowrap">
          {formatUnixDateTimeShort(unix)}
        </Span>
        {by && (
          <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={testId}>
            {t("restock.table.by", { name: by })}
          </Span>
        )}
      </Stack>
    );
  }

  // Only ever rendered on an ACCEPTED row — shortfall() returns 0 before the warehouse has counted, because an
  // uncounted box is not a short one.
  function missingBadge(request: RestockRequest) {
    const missing = shortfall(request);
    if (missing <= 0n) return null;

    return (
      <Badge colorPalette="warning" data-testid={`restock-missing-${request.id}`}>
        {t("restock.table.missingBadge", { count: Number(missing) })}
      </Badge>
    );
  }

  // The row's ⋯ — what the status allows. A row whose status allows nothing has no menu at all rather than a disabled
  // one. Stops the row's navigate from firing when it is used.
  function rowActions(request: RestockRequest) {
    if (teamId === undefined) return null;

    return (
      <Box display="inline-flex" onClick={(e) => e.stopPropagation()}>
        <SellingRestockActions
          request={request}
          teamId={teamId}
          variant="menu"
          cancelReviewMark={<NotImplemented list={RESTOCK_SELLING_PENDING} id="cancelReview" />}
        />
      </Box>
    );
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.selling.title")}</Heading>
        <Text color="fg.muted" data-testid="restock-requests-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  function list() {
    if (requests.length === 0 && !error) {
      // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint) — nothing matches: clear the filters; an empty tab: which
      // status has none; nothing yet: raise one.
      if (narrowed) {
        return (
          <EmptyHint
            icon={SearchX}
            title={t("restock.selling.none")}
            description={t("emptyHint.noMatch")}
            action={
              <Button variant="outline" colorPalette="gray" onClick={clearFilters}>
                {t("common.clearFilters")}
              </Button>
            }
            testId="restock-requests-empty"
          />
        );
      }

      // "…none yet" is only true of the whole list. Under a tab the list is not empty, THIS STATUS is — so say which
      // one, reusing the tab's OWN labelKey rather than rebuilding it from the tab value (#130).
      const wholeList = activeTab.status === RestockRequestStatus.UNSPECIFIED;

      return (
        <EmptyHint
          icon={ClipboardList}
          title={
            wholeList
              ? t("restock.empty")
              : t("restock.emptyFiltered", { status: t(activeTab.labelKey).toLowerCase() })
          }
          description={wholeList ? t("restock.selling.emptyHint") : undefined}
          action={
            wholeList ? (
              <Button colorPalette="brand" data-testid="open-create-restock-empty" onClick={newRestock}>
                <Icon as={Plus} boxSize="4" />
                {t("restock.newRequest")}
              </Button>
            ) : undefined
          }
          testId="restock-requests-empty"
        />
      );
    }

    if (isMobile) {
      // A PHONE READS EACH RESTOCK AS A BLOCK (a-phone-reads-each-line-as-a-block) — the number and its status, when and
      // by whom, where it was bought, where it is going, then what is in it beside what it cost. The accepted date, the
      // references and the courier are the detail page's.
      return (
        <Stack gap="2" data-testid="restock-requests-table">
          {requests.map((request) => {
            const warehouse = warehouseTeams[request.warehouseId.toString()];

            return (
              <Stack
                key={request.id.toString()}
                data-testid={`restock-row-${request.id}`}
                borderWidth="1px"
                borderRadius="md"
                p="3"
                gap="1.5"
                // It opens the restock, so it lights up and gives a little under a thumb (a-table-row-lights-up).
                {...PRESSABLE}
                onClick={() => open(request)}
              >
                <Flex align="start" gap="2">
                  <Stack gap="0.5" flex="1" minW="0">
                    <HStack gap="2" wrap="wrap">
                      <Text fontWeight="bold">#{request.id.toString()}</Text>
                      <RestockStatusBadge status={request.status} />
                      {missingBadge(request)}
                    </HStack>
                    {raised(request)}
                  </Stack>
                  {rowActions(request)}
                </Flex>

                <Box data-testid={`restock-supplier-${request.id}`}>
                  <RowSupplier request={request} suppliers={suppliers} stores={stores} />
                </Box>

                <HStack gap="1.5" fontSize="sm" color="fg.muted" minW="0">
                  <Icon as={Warehouse} boxSize="4" flexShrink={0} />
                  <Text truncate>
                    {warehouse?.name || t("restock.warehouseRef", { id: request.warehouseId.toString() })}
                  </Text>
                </HStack>

                <Flex align="end" justify="space-between" gap="2">
                  <RestockItemsCell items={request.items} />
                  <Text fontWeight="bold" whiteSpace="nowrap" data-testid={`restock-value-${request.id}`}>
                    {formatRupiahNumber(committedValue(request))}
                  </Text>
                </Flex>
              </Stack>
            );
          })}
        </Stack>
      );
    }

    return (
      // Ten columns do not fit every window — the table scrolls inside its own box, never the page.
      <Box overflowX="auto" w="full" maxW="full" minW="0">
        <Table.Root size="sm" data-testid="restock-requests-table">
          <Table.Header>
            {/* THE OWNER'S ORDER (owner: *"dimulai dari referensi … dilanjutkan pemasok, gudang, produk, total, pengiriman,
                status, tgl dibuat, tgl diterima, dan aksi"*, the-restock-list-leads-with-its-references): what somebody
                quotes first, then what was bought and where it went, what it cost and how it travels, where it has got
                to, and its two dates. Our own #id is not a column — the row opens the restock, and the search finds it
                by number. */}
            <Table.Row>
              <Table.ColumnHeader>{t("restock.table.reference")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.supplier")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.warehouse")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.product")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("restock.table.total")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.shipment")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.status")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.created")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.accepted")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("restock.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {requests.map((request) => {
              const warehouse = warehouseTeams[request.warehouseId.toString()];

              return (
                <Table.Row
                  key={request.id.toString()}
                  data-testid={`restock-row-${request.id}`}
                  cursor="pointer"
                  css={LIGHTS_UP}
                  onClick={() => open(request)}
                >
                  <Table.Cell data-testid={`restock-reference-${request.id}`}>
                    <ReferenceCell request={request} />
                  </Table.Cell>
                  <Table.Cell minW="44" data-testid={`restock-supplier-${request.id}`}>
                    <RowSupplier request={request} suppliers={suppliers} stores={stores} />
                  </Table.Cell>
                  {/* The shared TeamItem (owner) — avatar, name and type badge, so a warehouse reads the same here as it
                      does in the switcher and on the returns list. An unresolved id still renders: TeamItem falls back
                      to "Team #id" rather than a blank cell, which is the honest reading of a lookup that failed. */}
                  <Table.Cell minW="52">
                    <TeamItem
                      team={{
                        teamId: request.warehouseId,
                        teamName: warehouse?.name,
                        teamType: warehouse?.type,
                        imageUrl: warehouse?.imageUrl,
                      }}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <RestockItemsCell items={request.items} />
                  </Table.Cell>
                  <Table.Cell textAlign="end" whiteSpace="nowrap" data-testid={`restock-value-${request.id}`}>
                    {formatRupiahNumber(committedValue(request))}
                  </Table.Cell>
                  <Table.Cell>
                    <ShipmentChannelBadge
                      channelId={request.shipmentId}
                      channel={couriers.data?.get(request.shipmentId.toString())}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Stack gap="1" align="start">
                      <RestockStatusBadge status={request.status} />
                      {missingBadge(request)}
                    </Stack>
                  </Table.Cell>
                  {/* Created: when, and BY WHOM — one event, so one cell. Date AND TIME (owner): several restocks are
                      raised in one morning, and the day alone cannot put them in order. */}
                  <Table.Cell>
                    {whenBy(request.createdAtUnix, request.createdByUserId, `restock-created-by-${request.id}`)}
                  </Table.Cell>
                  {/* Accepted: when the goods landed, and WHO counted them — the person on the other side to ask about
                      a short delivery. Empty until it happens, which is the honest reading of a request nobody has
                      opened the box for. */}
                  <Table.Cell>
                    {whenBy(request.acceptedAtUnix, request.acceptedByUserId, `restock-accepted-by-${request.id}`)}
                  </Table.Cell>
                  {/* An overflow MENU (owner): ongoing has three actions, and named items with leading icons are the
                      house pattern for row actions. */}
                  <Table.Cell textAlign="end">{rowActions(request)}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      </Box>
    );
  }

  // The Statistik button — at the end of the tab row on a desktop, an icon beside Filter on a phone
  // (a-statistics-button-ends-the-tab-row). One mounts, so its test id is the same on both.
  const statsToggle = (
    <StatsToggle
      open={statsOpen}
      onToggle={() => setStatsOpen((open) => !open)}
      label={t("restock.selling.statistics")}
      compact={isMobile}
      testId="restock-summary-toggle"
    />
  );

  return (
    // The page arrives — a fade and a short rise (`motion-is-small-quick-and-shared`).
    <Stack gap="section" animationStyle="enter" data-testid="restock-selling-page">
      <Flex align="center" gap="card">
        <Heading size="md" flex="1" minW="0">
          {t("restock.selling.title")}
        </Heading>
        {/* THE ACTIONS CARRY THEIR ICONS (an-action-button-carries-its-icon) — Export, then New Restock, the order list's
            pair; on a phone they are their icons (a-phone-header-action-is-an-icon). */}
        {isMobile ? (
          <CompactActions
            menuLabel={t("restock.selling.actions")}
            actions={[
              {
                id: "export",
                label: t("restock.selling.export"),
                icon: Download,
                mark: <NotImplemented list={RESTOCK_SELLING_PENDING} id="export" />,
                testId: "restock-export",
                onClick: exportList,
              },
              {
                id: "create",
                label: t("restock.newRequest"),
                icon: Plus,
                primary: true,
                testId: "open-create-restock",
                onClick: newRestock,
              },
            ]}
          />
        ) : (
          <Flex gap="2" align="center">
            <Button size="xs" variant="outline" colorPalette="gray" data-testid="restock-export" onClick={exportList}>
              <Icon as={Download} boxSize="4" />
              {t("restock.selling.export")}
              <NotImplemented list={RESTOCK_SELLING_PENDING} id="export" />
            </Button>
            <Button size="xs" colorPalette="brand" data-testid="open-create-restock" onClick={newRestock}>
              <Icon as={Plus} boxSize="4" />
              {t("restock.newRequest")}
            </Button>
          </Flex>
        )}
      </Flex>

      {/* What is not real yet — the export, the courier filter and the statistics; the list itself is. */}
      <NotImplementedSummary list={RESTOCK_SELLING_PENDING} />

      {/* THE SHARED FILTER STRIP (a-phone-filters-from-a-sheet, clear-filters-is-red-and-bold) — the search stays in the
          row on a phone; the rest are in the sheet. */}
      <FilterBar
        testId="restock-filter"
        active={filtering > 0}
        count={filtering}
        onClear={clearFilters}
        // ON A PHONE THE STATISTIK BUTTON IS AN ICON BESIDE FILTER (a-statistics-button-ends-the-tab-row) — the tab row
        // there already scrolls sideways under six tabs, and the search row holds the other control that reshapes the list.
        actions={isMobile ? statsToggle : undefined}
      >
        <FilterSearch
          value={search}
          onChange={(value) => refilter(() => setSearch(value))}
          placeholder={t("restock.selling.searchPlaceholder")}
          testId="restock-search"
        />
        {/* WHICH WAREHOUSE the goods are going to — a selling team ships to several. Every option is a warehouse, so the
            pick is its name alone (a-one-type-picker-shows-the-name-alone). */}
        <FilterField w="15rem" testId="restock-warehouse-filter">
          <TeamSelect
            value={warehouseFilter > 0n ? warehouseFilter : undefined}
            teamType={TeamType.WAREHOUSE}
            showType={false}
            placeholder={t("restock.warehouseAll")}
            onChange={(id) => refilter(() => setWarehouseFilter(id))}
          />
        </FilterField>
        {/* WHICH COURIER brought it (owner: *"restok ada filter pengiriman"*) — the courier picker the restock form names
            one with, clearable back to any. Marked: `RestockRequestListFilter` has no courier yet, so the pick is held
            and the rows do not move (`dropped`). */}
        <FilterField w="15rem" testId="restock-courier-filter">
          <Flex align="center" gap="1">
            <Box flex="1" minW="0">
              <ShipmentChannelSelect
                value={courierFilter > 0n ? courierFilter : undefined}
                placeholder={t("restock.selling.courierAll")}
                onChange={(id) => refilter(() => setCourierFilter(id))}
              />
            </Box>
            <NotImplemented list={RESTOCK_SELLING_PENDING} id="courier" />
          </Flex>
        </FilterField>
        {/* BY PERSON (owner) — TWO pickers, because they answer two questions asked by two people: a manager reviewing
            purchasing asks whose orders these are, somebody chasing a bad delivery asks who was at the door. One
            "involved this person" box could not say which.

            Each offers the people on THIS list's rows (a-who-filter-lists-the-people-on-its-rows), answered by
            inventory_service — not a member list. The author is one of this team's own, current or former; the person
            who counted the goods works at a warehouse whose members this team cannot read, and is offered all the
            same, because they are on its rows. Staff and Customer Service use them too
            (whoever-reads-a-list-may-filter-it). */}
        <FilterField w="15rem" testId="restock-created-by-filter">
          <PersonFilterSelect
            people={createdBy.data}
            error={createdBy.isError}
            value={createdByFilter > 0n ? createdByFilter : undefined}
            placeholder={t("restock.createdByAll")}
            // A cleared picker emits undefined → 0n, "everyone" — the filter is removed, not stuck.
            onChange={(id) => refilter(() => setCreatedByFilter(id ?? 0n))}
          />
        </FilterField>
        <FilterField w="15rem" testId="restock-accepted-by-filter">
          <PersonFilterSelect
            people={acceptedBy.data}
            error={acceptedBy.isError}
            value={acceptedByFilter > 0n ? acceptedByFilter : undefined}
            placeholder={t("restock.acceptedByAll")}
            onChange={(id) => refilter(() => setAcceptedByFilter(id ?? 0n))}
          />
        </FilterField>
        {/* WHICH DATE, THEN WHICH WINDOW — one panel (a-date-type-is-picked-inside-the-range-panel, #224): without the
            date type a range would silently pick one of a restock's dates and mislabel the others. */}
        <FilterField w="auto">
          <DateRangePicker
            value={range}
            onChange={(r) => refilter(() => setRange(r))}
            fields={RESTOCK_DATE_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
            field={dateField}
            onFieldChange={(v) => refilter(() => setDateField(v))}
            testId="restock-date"
          />
        </FilterField>
      </FilterBar>

      {/* One panel, whose value tracks the active tab: every tab shows the SAME list — only the `status` sent to the RPC
          differs — so there is nothing to duplicate per tab. The row scrolls sideways on a phone rather than wrap.

          ON A DESKTOP THE STATISTIK BUTTON ENDS THE TAB ROW (owner: *"kurasa banyak ruang kosong"*, then *"A"*;
          a-statistics-button-ends-the-tab-row) — it had a row of its own. The rule runs under both, so the list keeps
          none of its own and the wrapper draws it; the picked tab's underline still lands on it. */}
      <Tabs.Root value={tab} onValueChange={(e) => refilter(() => setTab(e.value))}>
        <Flex align="stretch" gap="2" borderBottomWidth="1px" borderColor="border">
          <Tabs.List flex="1" minW="0" borderBottomWidth="0" flexWrap="nowrap" overflowX="auto" overflowY="hidden">
            {RESTOCK_STATUS_TABS.map((item) => (
              <Tabs.Trigger
                key={item.value}
                value={item.value}
                flexShrink={0}
                data-testid={`restock-tab-${item.value}`}
              >
                {t(item.labelKey)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {!isMobile && (
            <Flex align="center" flexShrink={0}>
              {statsToggle}
            </Flex>
          )}
        </Flex>

        {/* THE STATISTICS, UNDER THE TABS AND SHUT (owner: *"statistiknya adalah di bawah tab status"*, *"kita tutup
            saja"*; the-restock-statistics-count-transactions-under-the-tabs) — the order list's Statistik button. Shut on
            every visit, page state only; the strip mounts, and reads, only while open. The tab above decides which strip:
            the piles on Semua Status, that status's figures on a status. */}
        <Collapsible.Root open={statsOpen} lazyMount unmountOnExit>
          <Collapsible.Content>
            <Box pt="card" data-testid="restock-summary-panel">
              {teamId !== undefined && <Statistics teamId={teamId} tab={tab} />}
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>

        <Tabs.Content value={tab}>
          <Stack gap="section">
            {error && (
              <Text color="error.fg" data-testid="restock-requests-error">
                {error}
              </Text>
            )}

            {/* THE FIRST LOAD SHOWS THE LIST'S SHAPE, and the rows fade in over it (motion-is-small-quick-and-shared).
                Once — a refresh keeps the rows mounted, so nothing fades again. */}
            {loading ? (
              <ListSkeleton testId="restock-requests-loading" />
            ) : (
              <Box animationStyle="swap">
                <RefreshOverlay busy={refreshing}>{list()}</RefreshOverlay>
              </Box>
            )}

            {/* THE PAGES GROW AS THEY ARE OPENED, and the pager is always on screen (every-list-pages-with-the-growing-
                pager, the-pager-is-always-on-screen). */}
            <GrowingPager
              page={page}
              onPageChange={setPage}
              hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
              resetKey={[
                tab,
                term,
                warehouseFilter,
                createdByFilter,
                acceptedByFilter,
                dateRangeCodec.encode(range),
                dateField,
                pageSize,
              ].join("|")}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              testId="restock-pager"
            />
          </Stack>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

// THE OPEN STATISTICS — mounted only while the Statistik button is open, so nothing behind them is read before. The
// figures are SAMPLES (summarySample.ts); the paying accounts are the team's real operational ones, which a restock is
// paid from.
function Statistics({ teamId, tab }: { teamId: bigint; tab: string }) {
  const data = useMemo(() => sampleRestockSummary(teamId), [teamId]);
  const accounts = useFinancialAccountOptions({ teamId, operationalOnly: true });
  const [payments, setPayments] = useState<RestockPile | null>(null);

  return (
    <>
      <RestockSummary
        data={data}
        tab={tab}
        marks={<NotImplemented list={RESTOCK_SELLING_PENDING} id="summary" />}
        onPayments={setPayments}
      />
      <PaymentBreakdown
        open={payments !== null}
        onOpenChange={(open) => !open && setPayments(null)}
        rows={payments ? samplePaymentSplit(payments, accounts.data ?? []) : []}
        mark={<NotImplemented list={RESTOCK_SELLING_PENDING} id="payments" />}
      />
    </>
  );
}

// THE TWO NUMBERS PEOPLE QUOTE AT EACH OTHER (owner): the order number at the store this restock was bought from — its
// invoice (a-restock-has-one-invoice) — and the courier's tracking number. Both LABELLED, because "MP-4127" and
// "JP1830042" are two opaque strings; both COPYABLE (owner: *"order id dan resinya copyable"*), because each is pasted
// into another system — the store's dashboard, the courier's tracking page. A tracking number can run very long, so each
// is cut at a width and its tooltip says it whole (owner: *"harus ada pembatasan tapi juga harus ada cara lihat
// fullnya"*); the copy is always whole. Either may be absent; the cell shows what it has.
const REFERENCE_MAX_W = "10rem";

function ReferenceCell({ request }: { request: RestockRequest }) {
  const { t } = useTranslation();
  const invoice = request.invoiceRefId.trim();
  const receipt = request.receipt.trim();

  if (invoice === "" && receipt === "") return <Span color="fg.muted">—</Span>;

  return (
    <Stack gap="0" minW="0" align="start">
      {invoice !== "" && (
        <HStack gap="1" fontSize="xs" minW="0" maxW="full">
          <Span color="fg.muted" flexShrink={0}>
            {t("restock.table.invoiceLabel")}
          </Span>
          <CopyText value={invoice} fontSize="xs" maxW={REFERENCE_MAX_W} testId={`restock-invoice-${request.id}`} />
        </HStack>
      )}
      {receipt !== "" && (
        <HStack gap="1" fontSize="xs" minW="0" maxW="full">
          <Span color="fg.muted" flexShrink={0}>
            {t("restock.table.receiptLabel")}
          </Span>
          <CopyText value={receipt} mono maxW={REFERENCE_MAX_W} testId={`restock-receipt-${request.id}`} />
        </HStack>
      )}
    </Stack>
  );
}

// WHERE A ROW WAS BOUGHT — its first line's supplier and store, and how many OTHER suppliers its lines name. In practice
// a restock is one invoice from one store (a-restock-has-one-invoice), so this is usually the whole answer; the detail
// page lists every line's.
function RowSupplier({
  request,
  suppliers,
  stores,
}: {
  request: RestockRequest;
  suppliers: LineSupplierProps["suppliers"];
  stores: LineSupplierProps["channels"];
}) {
  const { t } = useTranslation();
  const named = request.items.filter((item) => item.supplierId > 0n);
  const first = named[0] ?? request.items[0];

  if (!first) return <Span color="fg.muted">—</Span>;

  const others = new Set(named.map((item) => item.supplierId.toString()));
  others.delete(first.supplierId.toString());

  // The others are said on the SUPPLIER's line, after its name — under the store they made the cell three lines
  // (one-context-per-column-and-never-three-lines).
  return (
    <LineSupplier
      supplierId={first.supplierId}
      supplierChannelId={first.supplierChannelId}
      suppliers={suppliers}
      channels={stores}
      after={
        others.size > 0 ? (
          <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap" flexShrink={0}>
            {t("restock.table.moreSuppliers", { count: others.size })}
          </Span>
        ) : undefined
      }
    />
  );
}
