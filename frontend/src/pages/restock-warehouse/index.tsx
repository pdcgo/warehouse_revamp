import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
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
import { Check, ChevronDown, PackageCheck, Printer, Receipt } from "lucide-react";
import { rpcError } from "../../api/clients";
import {
  RestockDateField,
  RestockRequestStatus,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { useRestockInbound, useRestockRequests } from "../../features/restock/queries";
import { RestockItemsCell } from "../../features/restock/RestockItemsCell";
import { RESTOCK_STATUS_TABS, restockTab } from "../../features/restock/statusTabs";
import { RESTOCK_DATE_FIELDS } from "../../features/restock/dateFields";
import { shortfall } from "../../features/restock/summary";
import { Pagination } from "../../components/Pagination";
import { RefreshOverlay } from "../../components/RefreshOverlay";
import { RestockStatusBadge } from "../../components/RestockStatusBadge";
import { ShippingBadge } from "../../components/ShippingBadge";
import { DateRangePicker, resolveRange } from "../../components/DateRangePicker";
import type { DateRange } from "../../components/DateRangePicker";
import { TeamSelect } from "../../components/TeamSelect";
import { UserSelect } from "../../components/UserSelect";
import { daysSinceUnix, formatUnixDate } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// THE WINDOW THIS SCREEN OPENS ON (owner): the last 7 days, not all time. A live relative range — it
// stores the day count, so it still means "the last 7 days" tomorrow without anyone touching it.
//
// ⚠ It is a lens on the TABLE ONLY, and the tiles above deliberately ignore it (see useRestockInbound).
// That is what keeps "Oldest waiting" honest — a queue age measured inside a 7-day window could never
// report more than 7 — but it also means a delivery that has waited longer than the window is COUNTED
// in the headline while having NO ROW under it. Read the tile as the prompt to widen the range.
const DEFAULT_RANGE: DateRange = { kind: "relative", days: 7 };

// How many names to resolve for the "From" column — see the same constant on the selling page.
const NAME_LOOKUP_SIZE = 200;

// WHICH ROLE the one person-filter is asking about. The two are genuinely different questions over
// different people — a buyer in a selling team raised it, this warehouse's own crew counted it — so
// the role also decides how the picker is SCOPED, not just which field the RPC gets.
type ActorRole = "created" | "accepted";

// RestockWarehousePage — the RESTOCK LIST AS THE RECEIVING WAREHOUSE SEES IT (#133).
//
// The other half of the screen that used to serve both sides (#122). A warehouse is not buying
// anything: it is working an INBOUND QUEUE. The job on this page is to find what is waiting and
// accept it — count what actually turned up and say which shelf it went on (#133/#137/#154) — and
// afterwards to print the labels and the receipt for what it shelved.
//
// MONEY IS IN THE HEADLINE, NOT IN THE ROWS (owner, 2026-07-30), and the split is the decision rather
// than an inconsistency. What the queue is WORTH is a fact about the warehouse's own exposure — the
// value it is about to become responsible for — and the crew is trusted with it. A per-line purchase
// price next to a product it is counting is a different thing: it is one supplier's invoice terms,
// shown to somebody doing a counting job, on every row. So the table still asks for `showPrices=false`
// while the tiles above it total the same lines.
//
// (This page previously refused money outright. The rule was narrowed, not dropped.)
//
// There is no "Destination" column for the mirror-image reason the selling list has no "Requested
// by": every row here targets the warehouse reading it, so the column could only repeat the team
// switcher. What varies — and therefore what leads, and what the one filter picks — is WHO the goods
// are coming FROM.
export function RestockWarehousePage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [requesterFilter, setRequesterFilter] = useState(0n);

  // ONE PERSON FILTER WITH A TYPE (owner), not two pickers: "which person" and "in which role" are
  // asked together, the way the date range asks "which window" and "which date" in one control.
  //
  // The cost, stated because it is invisible from the control: the pair can no longer be asked for.
  // The RPC still has both fields and would AND them, but the UI can only ever set one — "raised by
  // Ani AND counted by Budi" is not a question this screen offers.
  const [actorRole, setActorRole] = useState<ActorRole>("created");
  const [actorId, setActorId] = useState(0n);

  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [dateField, setDateField] = useState<RestockDateField>(RestockDateField.CREATED);

  const teamId = current?.teamId;

  const activeTab = restockTab(tab);
  const status = activeTab.status;

  const { fromUnix, toUnix } = resolveRange(range);

  const query = useRestockRequests({
    teamId,
    status,
    requestingTeamId: requesterFilter,
    // The role picks WHICH field carries the id; the other stays 0, which is "anyone".
    createdByUserId: actorRole === "created" ? actorId : 0n,
    acceptedByUserId: actorRole === "accepted" ? actorId : 0n,
    dateField,
    fromUnix,
    toUnix,
    page,
    pageSize,
  });

  // The headline follows the FROM lens and nothing else — see useRestockInbound for why the status
  // tabs deliberately do not move it. It is always the PENDING queue, so switching to Fulfilled shows
  // what has been done beneath a headline of what has not.
  const inbound = useRestockInbound({ teamId, requestingTeamId: requesterFilter });

  // Every team type, not just SELLING: a root team can raise a restock too, and a "From" column that
  // silently failed to name one would read as a missing team rather than an unfiltered lookup.
  const teams = useTeams({ page: 1, pageSize: NAME_LOOKUP_SIZE, reference: true });

  const teamNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const team of teams.data?.teams ?? []) out[team.id.toString()] = team.name;
    return out;
  }, [teams.data]);

  const requests = query.data?.requests ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  // Always-fresh means every tab, page and filter change refetches; `listQuery` keeps the rows that
  // are already up while it does, and RefreshOverlay is what says so. `isPending` is excluded — a
  // first load has nothing to keep and shows the spinner instead.
  const refreshing = query.isFetching && !query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // Any change to a filter restarts at page 1 — the page number belongs to the OLD question, and page
  // 5 of "everyone" is very likely past the end of "Bandung only".
  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  function selectTab(value: string) {
    refilter(() => setTab(value));
  }

  function teamLabel(id: bigint): string {
    return teamNames[id.toString()] ?? t("restock.teamRef", { id: id.toString() });
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.inbound.title")}</Heading>
        <Text color="fg.muted" data-testid="restock-inbound-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Stack gap="0">
          <Heading size="md">{t("restock.inbound.title")}</Heading>
          <Text fontSize="sm" color="fg.muted">
            {t("restock.inbound.subtitle")}
          </Text>
        </Stack>
        {/* No team badge (owner, 2026-07-30). The team switcher already names the team, and every row
            on this page targets it — so the badge restated the chrome, exactly as the title/badge/blurb
            did on the selling list before they were dropped for the same reason. */}
        <Spacer />
        {/* No "New restock" here, and that is the rule rather than an omission: a warehouse does not
            order goods for itself — it receives what a selling team bought (#105). */}
      </Flex>

      {/* WHAT IS STILL AT THE DOOR (owner). Server-side totals over every PENDING restock targeting
          this warehouse, so they describe the queue rather than the visible page — a headline that
          silently summarised page 1 of 6 would be worse than none, because it looks authoritative. */}
      <SimpleGrid columns={{ base: 2, md: 5 }} gap="card">
        {/* THE COARSEST COUNT LEADS — how many deliveries, which is what a shift is planned by. The
            three that follow break the same queue down into products, pieces and money. */}
        <Stat.Root>
          <Stat.Label>{t("restock.stat.inboundRestocks")}</Stat.Label>
          <Stat.ValueText data-testid="restock-stat-restocks">
            {(inbound.data?.restockCount ?? 0n).toString()}
          </Stat.ValueText>
          <Stat.HelpText>{t("restock.stat.inboundRestocksHint")}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("restock.stat.inboundProducts")}</Stat.Label>
          <Stat.ValueText data-testid="restock-stat-products">
            {(inbound.data?.productCount ?? 0n).toString()}
          </Stat.ValueText>
          <Stat.HelpText>{t("restock.stat.inboundProductsHint")}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("restock.stat.inboundUnits")}</Stat.Label>
          <Stat.ValueText
            color={(inbound.data?.unitCount ?? 0n) > 0n ? "orange.fg" : undefined}
            data-testid="restock-stat-units"
          >
            {(inbound.data?.unitCount ?? 0n).toString()}
          </Stat.ValueText>
          <Stat.HelpText>{t("restock.stat.inboundUnitsHint")}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("restock.stat.inboundAmount")}</Stat.Label>
          <Stat.ValueText data-testid="restock-stat-amount">
            {formatRupiah(inbound.data?.amount ?? 0n)}
          </Stat.ValueText>
          <Stat.HelpText>{t("restock.stat.inboundAmountHint")}</Stat.HelpText>
        </Stat.Root>
        {/* THE AGE, not the date, is the value — "3 days" is the thing worth acting on, and a count of
            7 waiting hides the box that has sat since Monday behind six that came this morning. The
            date it was raised goes underneath, because that is what someone chases it by. An empty
            queue has no oldest, so it is an em dash rather than "0 days". */}
        <Stat.Root>
          <Stat.Label>{t("restock.stat.oldestPending")}</Stat.Label>
          <Stat.ValueText
            color={daysSinceUnix(inbound.data?.oldestPendingUnix ?? 0n) >= 3 ? "red.fg" : undefined}
            data-testid="restock-stat-oldest"
          >
            {(inbound.data?.oldestPendingUnix ?? 0n) > 0n
              ? t("restock.stat.oldestDays", {
                  count: daysSinceUnix(inbound.data?.oldestPendingUnix ?? 0n),
                })
              : "—"}
          </Stat.ValueText>
          <Stat.HelpText data-testid="restock-stat-oldest-date">
            {formatUnixDate(inbound.data?.oldestPendingUnix ?? 0n)}
          </Stat.HelpText>
        </Stat.Root>
      </SimpleGrid>

      <Flex gap="card" wrap="wrap" align="center">
        {/* WHO THE GOODS ARE COMING FROM — the mirror of the buying screen's warehouse lens. SELLING
            teams only (owner): buying is what a selling team does, so that is the list worth
            offering. The consequence, recorded because it is invisible from the control: a restock
            raised by the ROOT team still appears in the table but cannot be picked here, so its
            deliveries are filterable only by leaving this unset. The "From" column resolves every
            team type regardless — the lookup below is deliberately NOT restricted, or a root-raised
            row would show a bare id.

            This lens narrows the tiles above as well as the table, because it restates the question
            rather than picking rows out of an answer — unlike the date range beside it. */}
        <Box maxW="64" w="full">
          <TeamSelect
            value={requesterFilter > 0n ? requesterFilter : undefined}
            teamType={TeamType.SELLING}
            placeholder={t("restock.inbound.fromAll")}
            onChange={(id) => refilter(() => setRequesterFilter(id))}
          />
        </Box>
        {/* The range picker carries the DATE TYPE itself (#224): its `fields` segment chooses which of
            a restock's three timestamps the window filters on. Without that, a range would silently
            pick one and mislabel the other two. Defaults to the last 7 days — see DEFAULT_RANGE. */}
        <DateRangePicker
          value={range}
          onChange={(r) => refilter(() => setRange(r))}
          fields={RESTOCK_DATE_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
          field={dateField}
          onFieldChange={(v) => refilter(() => setDateField(v))}
          testId="restock-inbound-date"
        />

        {/* BY PERSON — the role segment and the picker read as ONE control (owner), so they sit in one
            bordered group the way the range picker carries its date-type segment.

            THE ROLE DECIDES THE SCOPE, and that is the substance of it rather than a detail. "Raised
            by" is somebody in a SELLING team, so the picker searches across teams — scoping it to the
            reader's own team would offer warehouse staff, who never raise a restock, and hide every
            buyer there is. "Counted by" is this warehouse's OWN crew, so it scopes to the current team
            and offers a short, correct list of the people who stand at the door.

            Switching the role CLEARS the person, and it has to: the people valid for one role are
            mostly invalid for the other, so keeping the id would silently re-ask the new question
            about somebody who cannot be its answer — and return an empty list that looks like a bug.

            "Counted by" also implies an accepted restock: nobody counted a pending one, so pairing it
            with the Pending tab returns nothing. That is the honest answer, not a fault. */}
        {/* ONE FORM GROUP: [ Raised by ▾ │ 🔍 person ]. The same shape DateRangePicker uses for its
            date-field segment — an outer bordered Flex, a ghost Menu button with square corners, a
            1px divider, and the real control with its own border dropped (`flush`). Two separate
            bordered boxes read as two independent filters; one box says the left half names what the
            right half is asking. */}
        <Flex
          borderWidth="1px"
          borderColor="border"
          borderRadius="l2"
          overflow="hidden"
          align="stretch"
          maxW="96"
          w="full"
        >
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                variant="ghost"
                borderRadius="0"
                flexShrink="0"
                data-testid="restock-inbound-actor-role"
              >
                <Text truncate>
                  {actorRole === "created"
                    ? t("restock.inbound.actorCreated")
                    : t("restock.inbound.actorAccepted")}
                </Text>
                <Icon as={ChevronDown} boxSize="4" color="fg.muted" />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content>
                  {(["created", "accepted"] as ActorRole[]).map((role) => (
                    <Menu.Item
                      key={role}
                      value={role}
                      onSelect={() =>
                        refilter(() => {
                          setActorRole(role);
                          setActorId(0n);
                        })
                      }
                    >
                      <Icon as={Check} boxSize="4" visibility={role === actorRole ? "visible" : "hidden"} />
                      {role === "created"
                        ? t("restock.inbound.actorCreated")
                        : t("restock.inbound.actorAccepted")}
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>

          <Box borderRightWidth="1px" borderColor="border" />

          <Box flex="1" minW="0">
            <UserSelect
              // Remounted per role so the combobox drops the previous role's loaded options — they
              // came from a different search (all users vs this team's members).
              key={actorRole}
              flush
              value={actorId > 0n ? actorId : undefined}
              teamId={actorRole === "accepted" ? teamId : undefined}
              placeholder={t("restock.inbound.actorAll")}
              onChange={(id) => refilter(() => setActorId(id))}
            />
          </Box>
        </Flex>
        <Spacer />
      </Flex>

      <Tabs.Root value={tab} onValueChange={(e) => selectTab(e.value)}>
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
              <Text color="red.fg" data-testid="restock-inbound-error">
                {error}
              </Text>
            )}

            {loading ? (
              <Spinner colorPalette="brand" />
            ) : (
              <Table.Root size="sm" data-testid="restock-inbound-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("restock.table.restock")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.from")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.status")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.product")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("restock.table.shipment")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("restock.table.actions")}
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>

                <Table.Body>
                  {requests.map((request) => {
                    const isPending = request.status === RestockRequestStatus.PENDING;
                    const isFulfilled = request.status === RestockRequestStatus.FULFILLED;
                    const short = shortfall(request);

                    return (
                      <Table.Row
                        key={request.id.toString()}
                        data-testid={`restock-row-${request.id}`}
                        cursor="pointer"
                        _hover={{ bg: "bg.subtle" }}
                        onClick={() => navigate(`/inventories/restock/${request.id}`)}
                      >
                        <Table.Cell data-testid={`restock-open-${request.id}`}>
                          <Stack gap="0">
                            <Span fontWeight="medium">#{request.id.toString()}</Span>
                            <Span fontSize="xs" color="fg.muted">
                              {formatUnixDate(request.createdAtUnix)}
                            </Span>
                          </Stack>
                        </Table.Cell>
                        <Table.Cell>{teamLabel(request.requestingTeamId)}</Table.Cell>
                        <Table.Cell>
                          <Stack gap="1" align="start">
                            <RestockStatusBadge status={request.status} />
                            {/* The warehouse's OWN count is what produced this gap, so it belongs on
                                its list too — it is the record of what it reported at the door. */}
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
                        <Table.Cell>
                          {/* Unpriced here, deliberately — see the money note in this page's header
                              comment. The warehouse's DETAIL page still prices the same lines. */}
                          <RestockItemsCell items={request.items} showPrices={false} />
                        </Table.Cell>
                        <Table.Cell>
                          <Stack gap="0" align="start">
                            <ShippingBadge code={request.shippingCode} />
                            {request.receipt && (
                              <Span fontSize="xs" color="fg.muted">
                                {request.receipt}
                              </Span>
                            )}
                          </Stack>
                        </Table.Cell>

                        {/* Stop the row's navigate from firing when a row action is used. */}
                        <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                          <HStack justify="end" gap="1">
                            {/* Accepting is COUNTING (#133), and since #154 also placing and writing
                                off — a form with sections, so the row action opens the Accept PAGE
                                (#157). There is deliberately no one-click "as asked". */}
                            {isPending && (
                              <IconButton
                                size="xs"
                                variant="ghost"
                                colorPalette="green"
                                aria-label={t("restock.receive.title")}
                                data-testid={`fulfil-${request.id}`}
                                onClick={() =>
                                  navigate(`/inventories/restock/${request.id}/accept`)
                                }
                              >
                                <Icon as={PackageCheck} boxSize="4" />
                              </IconButton>
                            )}

                            {/* What the crew does immediately AFTER accepting: stick a label on each
                                shelved placement (#207), and file the goods-received document. */}
                            {isFulfilled && (
                              <IconButton
                                size="xs"
                                variant="ghost"
                                aria-label={t("restock.labels.action")}
                                data-testid={`labels-${request.id}`}
                                onClick={() =>
                                  navigate(`/inventories/restock/${request.id}/labels`)
                                }
                              >
                                <Icon as={Printer} boxSize="4" />
                              </IconButton>
                            )}

                            {isFulfilled && (
                              <IconButton
                                size="xs"
                                variant="ghost"
                                aria-label={t("restock.table.receipt")}
                                data-testid={`receipt-${request.id}`}
                                onClick={() =>
                                  navigate(`/inventories/restock/${request.id}/receipt`)
                                }
                              >
                                <Icon as={Receipt} boxSize="4" />
                              </IconButton>
                            )}
                          </HStack>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}

            {!loading && requests.length === 0 && !error && (
              <Text color="fg.muted" data-testid="restock-inbound-empty">
                {activeTab.status === RestockRequestStatus.UNSPECIFIED
                  ? t("restock.inbound.empty")
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
