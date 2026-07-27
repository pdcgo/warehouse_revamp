import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  Icon,
  IconButton,
  Input,
  Menu,
  Portal,
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
import { Ban, MoreHorizontal, Pencil } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import {
  RestockDateField,
  RestockRequestStatus,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import type { Team } from "../../gen/warehouse/team/v1/team_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { useSuppliers } from "../../features/suppliers/queries";
import {
  useRestockOngoing,
  useRestockRequests,
  useCancelRestockRequest,
} from "../../features/restock/queries";
import { RestockItemsCell } from "../../features/restock/RestockItemsCell";
import { RESTOCK_STATUS_TABS, restockTab } from "../../features/restock/statusTabs";
import { committedValue, shortfall } from "../../features/restock/summary";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ALL_DATES, DateRangePicker, resolveRange } from "../../components/DateRangePicker";
import type { DateRange } from "../../components/DateRangePicker";
import { Pagination } from "../../components/Pagination";
import { RestockStatusBadge } from "../../components/RestockStatusBadge";
import { ShippingBadge } from "../../components/ShippingBadge";
import { TeamItem } from "../../components/TeamItem";
import { TeamSelect } from "../../components/TeamSelect";
import { toaster } from "../../components/Toaster";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// How many names to resolve for the id columns. A page of restocks can only name as many warehouses
// and suppliers as it has rows, so one modest read covers every page-size the pager offers.
const NAME_LOOKUP_SIZE = 200;

// The three dates a restock has, offered as the range picker's field segment (#224's `fields` API).
// One control therefore picks BOTH which timestamp and which window — the same shape the returns
// list uses, because a return is a restock's mirror image (#163) and they should not diverge.
const DATE_FIELDS: { value: RestockDateField; labelKey: string }[] = [
  { value: RestockDateField.CREATED, labelKey: "restock.dateField.created" },
  { value: RestockDateField.ACCEPTED, labelKey: "restock.dateField.accepted" },
  { value: RestockDateField.CANCELLED, labelKey: "restock.dateField.cancelled" },
];

// RestockSellingPage — the RESTOCK LIST AS A BUYER SEES IT (#105).
//
// This was one screen shared with the warehouse (#122) until the two jobs were pulled apart, and the
// split is the point: a warehouse is looking at an inbound work queue ("what has landed that I have
// to count and shelve"), while a selling team is looking at PURCHASING — what it has bought, what it
// has committed money to, and whether it got what it paid for. The columns follow from that:
//
//   - the SUPPLIER leads, because buying is organised by who you bought from;
//   - the DESTINATION is a warehouse NAME, not "warehouse #3" — an id is not somewhere goods go;
//   - the VALUE is on the row, because a restock is where this team commits money and "what do I owe
//     on goods in flight" is the question this screen exists to answer;
//   - a SHORT delivery is flagged in the list, not only on the detail page. The gap between asked and
//     received is what someone chases the supplier about, and a discrepancy nobody scrolls to is a
//     discrepancy nobody chases.
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

  const cancelMutation = useCancelRestockRequest();

  // The two id → name lookups this screen's columns need. Both are ordinary paged lists read once
  // and turned into maps, the same way the products screen resolves its warehouses: the list RPC's
  // GENERAL slice carries the RESTOCK's own name, not its supplier's or its destination's.
  const warehouses = useTeams({
    teamType: TeamType.WAREHOUSE,
    page: 1,
    pageSize: NAME_LOOKUP_SIZE,
  });
  const suppliers = useSuppliers({ teamId, q: "", page: 1, pageSize: NAME_LOOKUP_SIZE });

  // Keyed to the whole TEAM, not just its name: the Destination cell renders the shared TeamItem
  // (owner), which wants the avatar and the type badge as well.
  const warehouseTeams = useMemo(() => {
    const out: Record<string, Team> = {};
    for (const team of warehouses.data?.teams ?? []) out[team.id.toString()] = team;
    return out;
  }, [warehouses.data]);

  const supplierNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const supplier of suppliers.data?.suppliers ?? []) {
      out[supplier.id.toString()] = supplier.name;
    }
    return out;
  }, [suppliers.data]);

  const requests = query.data?.requests ?? [];
  const actorNames = query.data?.actorNames;
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // Any change to a filter restarts at page 1 — the page number belongs to the OLD question, and
  // page 5 of "All Status" is very likely past the end of "Cancelled".
  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  // A restock legitimately has NO supplier (a transfer, a sample), so an unset id is an em dash and
  // not an error — only a set-but-unresolved id falls back to naming the number.
  function supplierLabel(id: bigint): string {
    if (id === 0n) return "";
    return supplierNames[id.toString()] ?? t("restock.detail.supplierRef", { id: id.toString() });
  }

  // Who did it. 0 is "not recorded" — every restock raised before the actor columns existed, and the
  // honest answer there is nothing rather than a name we would have to invent.
  function actorLabel(id: bigint): string {
    if (id === 0n) return "";
    return actorNames?.get(id.toString()) ?? t("restock.table.userRef", { id: id.toString() });
  }

  async function cancelRequest(request: RestockRequest) {
    if (teamId === undefined) {
      return;
    }

    try {
      await cancelMutation.mutateAsync({ teamId, requestId: request.id });
      toaster.create({ type: "success", title: t("restock.toast.cancelled") });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("restock.toast.cancelFailed"),
        description: rpcError(err),
      });
    }
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
          every pending restock, so they describe the team rather than the visible page. */}
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
        <Stat.Root>
          <Stat.Label>{t("restock.stat.ongoing")}</Stat.Label>
          <Stat.ValueText
            color={(ongoing.data?.qty ?? 0n) > 0n ? "orange.fg" : undefined}
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
          placeholder={t("restock.searchPlaceholder")}
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
        {/* The range picker carries the DATE TYPE itself (#224): its `fields` segment chooses which
            of a restock's three timestamps the window filters on. Without that, a range would
            silently pick one and mislabel the other two. */}
        <DateRangePicker
          value={range}
          onChange={(r) => refilter(() => setRange(r))}
          fields={DATE_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
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
          <Stack gap="section">
            {error && (
              <Text color="red.fg" data-testid="restock-requests-error">
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
                    <Table.ColumnHeader>{t("restock.table.supplier")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.destination")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.status")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.accepted")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.product")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.reference")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.shipment")}</Table.ColumnHeader>
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
                    const isPending = request.status === RestockRequestStatus.PENDING;
                    const short = shortfall(request);
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
                            <Span fontSize="xs" color="fg.muted">
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
                        <Table.Cell>{supplierLabel(request.supplierId) || "—"}</Table.Cell>
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
                            {/* Only ever rendered on a FULFILLED row — shortfall() returns 0 before
                                the warehouse has counted, because an uncounted line is not a line
                                that arrived empty. */}
                            {short > 0n && (
                              <Badge
                                colorPalette="orange"
                                data-testid={`restock-short-${request.id}`}
                              >
                                {t("restock.table.shortBy", { count: Number(short) })}
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
                        {/* THE TWO NUMBERS PEOPLE QUOTE AT EACH OTHER (owner): the order this
                            restock was bought against, and the courier's tracking number. Both are
                            LABELLED rather than stacked bare — "MP-4127" and "JP1830042" are two
                            opaque strings, and a reader cannot tell which is which without being
                            told. Either may legitimately be absent; the cell shows what it has. */}
                        <Table.Cell>
                          {request.orderRef || request.receipt ? (
                            <Stack gap="0" minW="0">
                              {request.orderRef && (
                                <Span fontSize="xs" data-testid={`restock-order-ref-${request.id}`}>
                                  {t("restock.table.orderRefValue", { value: request.orderRef })}
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
                          <ShippingBadge code={request.shippingCode} />
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          {formatRupiah(committedValue(request))}
                        </Table.Cell>

                        {/* Stop the row's navigate from firing when a row action is used. */}
                        <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                          {/* An overflow MENU rather than two bare icons (owner): a pencil and a
                              circle-slash at xs, ghost, in the last column read as decoration — the
                              actions were there and nobody could find them. Named items with leading
                              icons are the house pattern for row actions, and they say what they do.

                              Both are the REQUESTER's, and both are gated on PENDING for the same
                              physical reason (#131): until the warehouse accepts, nothing has moved
                              and the request is still an intention its author owns. A fulfilled or
                              cancelled row therefore has no menu at all rather than a disabled one —
                              there is nothing it could offer. */}
                          {isPending && (
                            <Menu.Root>
                              <Menu.Trigger asChild>
                                <IconButton
                                  size="xs"
                                  variant="ghost"
                                  aria-label={t("restock.table.actions")}
                                  data-testid={`restock-actions-${request.id}`}
                                >
                                  <Icon as={MoreHorizontal} boxSize="4" />
                                </IconButton>
                              </Menu.Trigger>
                              <Portal>
                                <Menu.Positioner>
                                  <Menu.Content>
                                    <Menu.Item
                                      value="edit"
                                      data-testid={`edit-${request.id}`}
                                      onClick={() =>
                                        navigate(`/inventories/restock/${request.id}/edit`)
                                      }
                                    >
                                      <Icon as={Pencil} boxSize="4" />
                                      {t("restock.edit")}
                                    </Menu.Item>

                                    {/* Cancelling is not trivially reversible, so it confirms. */}
                                    <ConfirmDialog
                                      title={t("restock.cancel.title")}
                                      message={t("restock.cancel.message")}
                                      confirmLabel={t("restock.cancel.confirm")}
                                      onConfirm={() => cancelRequest(request)}
                                      trigger={
                                        <Menu.Item
                                          value="cancel"
                                          color="red.fg"
                                          data-testid={`cancel-${request.id}`}
                                          // The menu must NOT close on this one: it opens a confirm
                                          // dialog, and a menu that closes takes the trigger with it.
                                          closeOnSelect={false}
                                        >
                                          <Icon as={Ban} boxSize="4" />
                                          {t("restock.cancel.action")}
                                        </Menu.Item>
                                      }
                                    />
                                  </Menu.Content>
                                </Menu.Positioner>
                              </Portal>
                            </Menu.Root>
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
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
