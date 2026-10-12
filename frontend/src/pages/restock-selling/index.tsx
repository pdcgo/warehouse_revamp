import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Input,
  SimpleGrid,
  Spacer,
  Spinner,
  Span,
  Stack,
  Stat,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
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
import { useRestockOngoing, useRestockPeople, useRestockRequests } from "../../features/restock/queries";
import { LineSupplier, useLineSuppliers } from "../../features/restock/LineSupplier";
import type { LineSupplierProps } from "../../features/restock/LineSupplier";
import { RestockItemsCell } from "../../features/restock/RestockItemsCell";
import { RESTOCK_STATUS_TABS, restockTab } from "../../features/restock/statusTabs";
import { RESTOCK_DATE_FIELDS } from "../../features/restock/dateFields";
import { committedValue, shortfall } from "../../features/restock/summary";
import { ALL_DATES, DateRangePicker, resolveRange } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { TeamItem } from "../../components/entity/TeamItem";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { PersonFilterSelect } from "../../components/pickers/PersonFilterSelect";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import { SellingRestockActions } from "../../features/restock/SellingRestockActions";
import { RESTOCK_SELLING_PENDING } from "./pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

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
// What is NOT here is as deliberate: no "Requested by" column, because every row on this screen was
// raised by the team reading it — RestockRequestList returns `requesting_team_id = team` OR
// `warehouse_id = team`, and a selling team is never a warehouse target, so that column only ever
// repeated the team switcher back at the reader. No page title, team badge or blurb either (owner):
// the breadcrumb names the screen and the switcher names the team, so all three restated the chrome.
//
// EVERY FILTER IS SERVER-SIDE, and that is not an implementation detail. The list is paginated, so a
// filter applied here would narrow the loaded page only — while `totalItems` went on counting the
// unfiltered set and the pager confidently offered pages that no longer existed.
export function RestockSellingPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState(0n);
  // 0 = anybody. Two ids, not one: see the pickers below for why the two sides are separate filters.
  const [createdByFilter, setCreatedByFilter] = useState(0n);
  const [acceptedByFilter, setAcceptedByFilter] = useState(0n);
  const [range, setRange] = useState<DateRange>(ALL_DATES);
  const [dateField, setDateField] = useState<RestockDateField>(RestockDateField.CREATED);

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
    q: search,
    page,
    pageSize,
  });

  // The headline follows the WAREHOUSE LENS and nothing else — see useRestockOngoing for why a
  // search box and a date range deliberately do not move it.
  const ongoing = useRestockOngoing({ teamId, warehouseId: warehouseFilter });

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
  // first load has nothing to keep and shows the spinner instead.
  const refreshing = query.isFetching && !query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // Any change to a filter restarts at page 1 — the page number belongs to the OLD question, and
  // page 5 of "All Status" is very likely past the end of "Cancelled".
  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  // Who did it. 0 is "not recorded" — every restock raised before the actor columns existed, and the
  // honest answer there is nothing rather than a name we would have to invent.
  function actorLabel(id: bigint): string {
    if (id === 0n) return "";
    // A NAME here, not the whole person: a table cell has room for "by Rina" and nothing more. The
    // avatar the same read carries is what the detail page's timeline renders instead.
    const user = actors?.get(id.toString());

    return user ? user.name || user.username : t("restock.table.userRef", { id: id.toString() });
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Text color="fg.muted" data-testid="restock-requests-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <NotImplementedSummary list={RESTOCK_SELLING_PENDING} />

      <Flex align="center" gap="card">
        <Spacer />
        <Button
          size="xs"
          colorPalette="brand"
          data-testid="open-create-restock"
          onClick={() => navigate("/inventories/restock/new")}
        >
          {t("restock.newRequest")}
        </Button>
      </Flex>

      {/* WHAT IS IN FLIGHT — the two numbers a buyer opens this screen for. Server-side totals over
          every restock still in flight, so they describe the team rather than the visible page. */}
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
        <Stat.Root>
          <Stat.Label>{t("restock.stat.ongoing")}</Stat.Label>
          <Stat.ValueText
            color={(ongoing.data?.qty ?? 0n) > 0n ? "warning.fg" : undefined}
            data-testid="restock-stat-ongoing"
          >
            {(ongoing.data?.qty ?? 0n).toString()}
          </Stat.ValueText>
          <Stat.HelpText>{t("restock.stat.ongoingHint")}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("restock.stat.ongoingValue")}</Stat.Label>
          <Stat.ValueText data-testid="restock-stat-ongoing-value">
            {formatRupiah(ongoing.data?.value ?? 0n)}
          </Stat.ValueText>
          <Stat.HelpText>{t("restock.stat.ongoingValueHint")}</Stat.HelpText>
        </Stat.Root>
      </SimpleGrid>

      <Flex gap="card" wrap="wrap" align="center">
        <Input
          maxW="sm"
          placeholder={t("restock.selling.searchPlaceholder")}
          value={search}
          data-testid="restock-search"
          onChange={(e) => refilter(() => setSearch(e.target.value))}
        />
        {/* WHICH WAREHOUSE the goods are going to. A selling team ships to several, and this is the
            lens that turns "what is in flight" into "what is in flight to Jakarta" — which is why it
            narrows the stat tiles above as well as the table below. */}
        <Box maxW="56" w="full">
          <TeamSelect
            value={warehouseFilter > 0n ? warehouseFilter : undefined}
            teamType={TeamType.WAREHOUSE}
            placeholder={t("restock.warehouseAll")}
            onChange={(id) => refilter(() => setWarehouseFilter(id))}
          />
        </Box>
        {/* BY PERSON (owner) — TWO pickers, because they answer two questions asked by two people:
            a manager reviewing purchasing asks whose orders these are, somebody chasing a bad
            delivery asks who was at the door. One "involved this person" box could not say which.

            Each offers the people on THIS list's rows (a-who-filter-lists-the-people-on-its-rows),
            answered by inventory_service — not a member list. The author is one of this team's own,
            current or former; the person who counted the goods works at a warehouse whose members
            this team cannot read, and is offered all the same, because they are on its rows. Staff
            and Customer Service use them too (whoever-reads-a-list-may-filter-it). */}
        <Box maxW="56" w="full" data-testid="restock-created-by-filter">
          <PersonFilterSelect
            people={createdBy.data}
            error={createdBy.isError}
            value={createdByFilter > 0n ? createdByFilter : undefined}
            placeholder={t("restock.createdByAll")}
            // A cleared picker emits undefined → 0n, "everyone" — the filter is removed, not stuck.
            onChange={(id) => refilter(() => setCreatedByFilter(id ?? 0n))}
          />
        </Box>
        <Box maxW="56" w="full" data-testid="restock-accepted-by-filter">
          <PersonFilterSelect
            people={acceptedBy.data}
            error={acceptedBy.isError}
            value={acceptedByFilter > 0n ? acceptedByFilter : undefined}
            placeholder={t("restock.acceptedByAll")}
            onChange={(id) => refilter(() => setAcceptedByFilter(id ?? 0n))}
          />
        </Box>
        {/* The range picker carries the DATE TYPE itself (#224): its `fields` segment chooses which
            of a restock's three timestamps the window filters on. Without that, a range would
            silently pick one and mislabel the other two. */}
        <DateRangePicker
          value={range}
          onChange={(r) => refilter(() => setRange(r))}
          fields={RESTOCK_DATE_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
          field={dateField}
          onFieldChange={(v) => refilter(() => setDateField(v))}
          testId="restock-date"
        />
        <Spacer />
      </Flex>

      {/* One panel, whose value tracks the active tab: every tab shows the SAME table — only the
          `status` sent to the RPC differs — so there is nothing to duplicate per tab. */}
      <Tabs.Root value={tab} onValueChange={(e) => refilter(() => setTab(e.value))}>
        <Tabs.List>
          {RESTOCK_STATUS_TABS.map((item) => (
            <Tabs.Trigger
              key={item.value}
              value={item.value}
              data-testid={`restock-tab-${item.value}`}
            >
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <RefreshOverlay busy={refreshing}>
          <Stack gap="section">
            {error && (
              <Text color="error.fg" data-testid="restock-requests-error">
                {error}
              </Text>
            )}

            {loading ? (
              <Spinner colorPalette="brand" />
            ) : (
              <Table.Root size="sm" data-testid="restock-requests-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("restock.table.restock")}</Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <HStack gap="1.5">
                        {t("restock.table.supplier")}
                        <NotImplemented list={RESTOCK_SELLING_PENDING} id="lineSupplier" />
                      </HStack>
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.destination")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.status")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.accepted")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.product")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.reference")}</Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <HStack gap="1.5">
                        {t("restock.table.shipment")}
                        <NotImplemented list={RESTOCK_SELLING_PENDING} id="courier" />
                      </HStack>
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.table.value")}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.table.actions")}
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>

                <Table.Body>
                  {requests.map((request) => {
                    const missing = shortfall(request);
                    const createdBy = actorLabel(request.createdByUserId);
                    const acceptedBy = actorLabel(request.acceptedByUserId);

                    return (
                      <Table.Row
                        key={request.id.toString()}
                        data-testid={`restock-row-${request.id}`}
                        cursor="pointer"
                        _hover={{ bg: "bg.subtle" }}
                        onClick={() => navigate(`/inventories/restock/${request.id}`)}
                      >
                        {/* Raised: the number, when, and BY WHOM. The author sits under the date it
                            belongs to rather than in a column of its own — the two are one fact, and
                            nine columns is already a wide table. */}
                        <Table.Cell data-testid={`restock-open-${request.id}`}>
                          <Stack gap="0">
                            <Span fontWeight="medium">#{request.id.toString()}</Span>
                            {/* Date AND TIME (owner) — several restocks are raised in one morning,
                                and the day alone cannot put them in order for the person who raised
                                them. Same on Accepted, where the clock is what someone remembers. */}
                            <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                              {formatUnixDateTime(request.createdAtUnix)}
                            </Span>
                            {createdBy && (
                              <Span
                                fontSize="xs"
                                color="fg.muted"
                                data-testid={`restock-created-by-${request.id}`}
                              >
                                {t("restock.table.by", { name: createdBy })}
                              </Span>
                            )}
                          </Stack>
                        </Table.Cell>
                        <Table.Cell minW="44" data-testid={`restock-supplier-${request.id}`}>
                          <RowSupplier request={request} suppliers={suppliers} stores={stores} />
                        </Table.Cell>
                        {/* The shared TeamItem (owner) — avatar, name and type badge, so a warehouse
                            reads the same here as it does in the switcher and on the returns list.
                            An unresolved id still renders: TeamItem falls back to "Team #id" rather
                            than a blank cell, which is the honest reading of a lookup that failed. */}
                        <Table.Cell minW="52">
                          <TeamItem
                            team={{
                              teamId: request.warehouseId,
                              teamName: warehouseTeams[request.warehouseId.toString()]?.name,
                              teamType: warehouseTeams[request.warehouseId.toString()]?.type,
                              imageUrl: warehouseTeams[request.warehouseId.toString()]?.imageUrl,
                            }}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <Stack gap="1" align="start">
                            <RestockStatusBadge status={request.status} />
                            {/* Only ever rendered on an ACCEPTED row — shortfall() returns 0 before
                                the warehouse has counted, because an uncounted box is not a short one. */}
                            {missing > 0n && (
                              <Badge
                                colorPalette="warning"
                                data-testid={`restock-missing-${request.id}`}
                              >
                                {t("restock.table.missingBadge", { count: Number(missing) })}
                              </Badge>
                            )}
                          </Stack>
                        </Table.Cell>
                        {/* Accepted: when the goods landed, and WHO counted them — the person on the
                            other side to ask about a short delivery. Empty until it happens, which is
                            the honest reading of a request nobody has opened the box for. */}
                        <Table.Cell>
                          {request.acceptedAtUnix > 0n ? (
                            <Stack gap="0">
                              <Span fontSize="xs">
                                {formatUnixDateTime(request.acceptedAtUnix)}
                              </Span>
                              {acceptedBy && (
                                <Span
                                  fontSize="xs"
                                  color="fg.muted"
                                  data-testid={`restock-accepted-by-${request.id}`}
                                >
                                  {t("restock.table.by", { name: acceptedBy })}
                                </Span>
                              )}
                            </Stack>
                          ) : (
                            <Span color="fg.muted">—</Span>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <RestockItemsCell items={request.items} />
                        </Table.Cell>
                        {/* THE TWO NUMBERS PEOPLE QUOTE AT EACH OTHER (owner): the store invoice
                            this restock was paid against (a-restock-has-one-invoice), and the courier's tracking number. Both are
                            LABELLED rather than stacked bare — "MP-4127" and "JP1830042" are two
                            opaque strings, and a reader cannot tell which is which without being
                            told. Either may legitimately be absent; the cell shows what it has. */}
                        <Table.Cell>
                          {request.invoiceRefId || request.receipt ? (
                            <Stack gap="0" minW="0">
                              {request.invoiceRefId && (
                                <Span fontSize="xs" data-testid={`restock-invoice-${request.id}`}>
                                  {t("restock.table.invoiceValue", { value: request.invoiceRefId })}
                                </Span>
                              )}
                              {request.receipt && (
                                <Span
                                  fontSize="xs"
                                  color="fg.muted"
                                  data-testid={`restock-receipt-${request.id}`}
                                >
                                  {t("restock.table.receiptValue", { value: request.receipt })}
                                </Span>
                              )}
                            </Stack>
                          ) : (
                            <Span color="fg.muted">—</Span>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <ShipmentChannelBadge
                            channelId={request.shipmentId}
                            channel={couriers.data?.get(request.shipmentId.toString())}
                          />
                        </Table.Cell>
                        <Table.Cell textAlign="end" whiteSpace="nowrap" data-testid={`restock-value-${request.id}`}>
                          {formatRupiah(committedValue(request))}
                        </Table.Cell>

                        {/* Stop the row's navigate from firing when a row action is used. */}
                        <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                          {/* An overflow MENU (owner): ongoing has three actions, and named items with leading
                              icons are the house pattern for row actions. A row whose status allows nothing has
                              no menu at all rather than a disabled one. */}
                          {teamId !== undefined && (
                            <SellingRestockActions
                              request={request}
                              teamId={teamId}
                              variant="menu"
                              pending={RESTOCK_SELLING_PENDING}
                            />
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}

            {!loading && requests.length === 0 && !error && (
              <Text color="fg.muted" data-testid="restock-requests-empty">
                {/* "…none yet" is only true of the whole list. Under a tab the list is not empty,
                    THIS STATUS is — so say which one, reusing the tab's OWN labelKey rather than
                    rebuilding it from the tab value (#130). */}
                {activeTab.status === RestockRequestStatus.UNSPECIFIED
                  ? t("restock.empty")
                  : t("restock.emptyFiltered", { status: t(activeTab.labelKey).toLowerCase() })}
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

  return (
    <Stack gap="0.5" minW="0">
      <LineSupplier
        supplierId={first.supplierId}
        supplierChannelId={first.supplierChannelId}
        suppliers={suppliers}
        channels={stores}
      />
      {others.size > 0 && (
        <Span fontSize="xs" color="fg.muted">
          {t("restock.table.moreSuppliers", { count: others.size })}
        </Span>
      )}
    </Stack>
  );
}
