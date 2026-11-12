import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Icon,
  IconButton,
  Menu,
  Portal,
  Span,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { Check, ChevronDown, PackageOpen, Printer, SearchX, X } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import {
  RestockActorRole,
  RestockDateField,
  RestockRequestStatus,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { useRestockInbound, useRestockPeople, useRestockRequests } from "../../features/restock/queries";
import { useShipmentChannelsByIds } from "../../features/shipment/queries";
import { RestockItemsCell } from "../../features/restock/RestockItemsCell";
import { RESTOCK_STATUS_TABS, restockTab } from "../../features/restock/statusTabs";
import { RESTOCK_DATE_FIELDS } from "../../features/restock/dateFields";
import { shortfall } from "../../features/restock/summary";
import { WarehouseRestockActions, warehouseActions } from "../../features/restock/WarehouseRestockActions";
import { LABELS_MAX_RESTOCKS, labelsPath } from "../../features/restock/labelsPath";
import { CompactActions } from "../../components/chrome/CompactActions";
import { fromHere } from "../../lib/cameFrom";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { CopyText } from "../../components/chrome/CopyText";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { RootTeamBadge } from "../../components/entity/ActorName";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { DateRangePicker, resolveRange } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { PersonFilterSelect } from "../../components/pickers/PersonFilterSelect";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useIsMobile } from "../../layouts/shell";
import { daysSinceUnix, formatUnixDate, formatUnixDateTimeShort } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { PRESSABLE } from "../../lib/motion";
import { useDebounced } from "../../lib/useDebounced";
import { dateRangeCodec, enumCodec, idCodec, oneOfCodec, textCodec, useUrlState } from "../../lib/urlState";
import { sampleCodPaid } from "./codSample";
import { RESTOCK_INBOUND_PENDING } from "./pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// THE WINDOW THIS SCREEN OPENS ON (owner): the last 7 days, not all time — the restock lists keep their 7 days
// (the-quick-ranges-are-days-then-months-then-years). A live relative range: it stores the day count, so it still means
// "the last 7 days" tomorrow.
//
// ⚠ It is a lens on the TABLE ONLY, and the cards above deliberately ignore it (see useRestockInbound). That is what keeps
// "Oldest waiting" honest — a queue age measured inside a 7-day window could never report more than 7 — but it also means
// a delivery that has waited longer than the window is COUNTED in the headline while having NO ROW under it. Read the
// card as the prompt to widen the range.
const DEFAULT_RANGE: DateRange = { kind: "relative", days: 7 };

// How many names to resolve for the "From" column — see the same constant on the selling page.
const NAME_LOOKUP_SIZE = 200;

// WHICH ROLE the one person-filter is asking about. The two are genuinely different questions over different people — a
// buyer in a selling team raised it, this warehouse's own crew counted it — so the role also decides how the picker is
// SCOPED, not just which field the RPC gets.
type ActorRole = "created" | "accepted";

// The status tab, the date type and the person's role as the URL carries them — only what this list offers is read back.
const STATUS_CODEC = oneOfCodec(RESTOCK_STATUS_TABS.map((item) => item.value));
const DATE_FIELD_CODEC = enumCodec(RESTOCK_DATE_FIELDS.map((f) => f.value));
const ACTOR_ROLE_CODEC = oneOfCodec<ActorRole>(["created", "accepted"]);

// RestockWarehousePage — the RESTOCK LIST AS THE RECEIVING WAREHOUSE SEES IT (#133).
//
// The other half of the screen that used to serve both sides (#122). A warehouse is not buying anything: it is working
// an INBOUND QUEUE. The job on this page is to find what is waiting, SIGN for a box when the courier hands it over, and
// ACCEPT it — count what actually turned up and say which placement it went on — and afterwards to print the labels and
// the receipt for what it shelved. Those two acts at the door are the warehouse's; everything else is the selling team's
// (the-warehouse-signs-and-accepts-the-team-does-the-rest), and each row offers exactly what its status allows
// (WarehouseRestockActions holds the matrix).
//
// THE WAREHOUSE SEES NO RESTOCK MONEY — only the COD IT PAID (owner: *"gudang tidak perlu tahu nilai restok, tapi nilai
// cod yang mereka bayarkan mungkin lebih baik"*, the-warehouse-sees-the-cod-it-paid). What the goods cost is the selling
// team's business; what the warehouse handed the courier at the door is its own, and owed back to it. So the rows ask for
// `showPrices=false`, and the one money card is that COD. (It replaced a queue value — the goods' worth — in 2026-11.)
//
// No "Destination" column: every row targets the warehouse reading it. What varies — and so what leads, and what the one
// team filter picks — is WHO the goods are coming FROM.
//
// THE SCREEN RULES (context_decision.md, applied when the owner opened this screen: *"list restok warehouse inisiasi"*,
// the-warehouse-restock-list-follows-the-screen-rules):
//
//   Restok Masuk
//   Kiriman yang menuju gudang ini — …
//   [Restok masuk 3] [Produk 4] [Pcs 74] [Menunggu paling lama 3 hari] [Ongkir COD dibayar Rp … ⚠]   ← SummaryStrip
//   [⌕ Cari restok, resi, order ID, atau SKU] [Dari semua tim ⌄] [Dibuat oleh ⌄│Siapa saja] [Dibuat · 7 hari terakhir]
//   Semua Status · Dalam Perjalanan · Tiba · Diterima · Hilang · Dibatalkan
//   Restok  Dari          Produk   Pengiriman     Status         Dibuat        Sampai          Aksi
//   #501    Toko Melati   …        [JNE]          [Dalam Perj.]  2 Nov 14:47   3 Nov 09:10     [Tandai Tiba] [Terima]
//           oleh Ani               JNE012… ⧉                                   oleh Budi      ← two lines, never three
//                                                  ‹ [1] ›    ← the growing pager, always on screen
//
// On a phone the filters are a sheet and each restock is a block.
//
// TICKED, THEN PRINTED AT ONCE (owner: *"listnya ada cekbox dan bisa cetak sekaligus yang dicheck"*,
// the-list-prints-the-ticked-restocks) — a box before each row, for the restocks that have labels (Tiba, Diterima; the
// rest are there, disabled); the header's box ticks every one of them on the page. While any is ticked the title's row
// offers *Cetak N Restok*, which opens Cetak Label with all of them. The ticks are held as ids, so they outlast a page,
// a tab or a filter — a morning's deliveries are gathered from Tiba and Diterima alike.
export function RestockWarehousePage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // The restocks ticked for printing, in the order they were ticked — the order they print in. At most
  // LABELS_MAX_RESTOCKS (at-most-fifty-restocks-a-print): past it a box does not tick.
  const [picked, setPicked] = useState<string[]>([]);
  const full = picked.length >= LABELS_MAX_RESTOCKS;
  const togglePick = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < LABELS_MAX_RESTOCKS ? [...prev, id] : prev,
    );
  const printPicked = () => navigate(labelsPath(picked.map((id) => BigInt(id))), { state: fromHere(location) });

  // THE FILTERS AND THE STATUS TAB LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh, or Back from a
  // restock, opens the same narrowed queue. The page number stays on screen only.
  const [tab, setTab] = useUrlState("status", "all", STATUS_CODEC);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useUrlState("q", "", textCodec);
  const [requesterFilter, setRequesterFilter] = useUrlState("from", 0n, idCodec);

  // ONE PERSON FILTER WITH A TYPE (owner), not two pickers: "which person" and "in which role" are asked together, the
  // way the date range asks "which window" and "which date" in one control. The cost, invisible from the control: the
  // pair can no longer be asked for — "raised by Ani AND counted by Budi" is not a question this screen offers.
  const [actorRole, setActorRole] = useUrlState<ActorRole>("role", "created", ACTOR_ROLE_CODEC);
  const [actorId, setActorId] = useUrlState("person", 0n, idCodec);

  // The people the role's question can be answered by — everyone who did that on a restock to this warehouse.
  const actorPeople = useRestockPeople({
    teamId: current?.teamId,
    role: actorRole === "created" ? RestockActorRole.CREATED : RestockActorRole.ACCEPTED,
  });

  const [range, setRange] = useUrlState<DateRange>("range", DEFAULT_RANGE, dateRangeCodec);
  const [dateField, setDateField] = useUrlState<RestockDateField>("date", RestockDateField.CREATED, DATE_FIELD_CODEC);

  // Typed, then settled — a word is one request to the server, not one per key.
  const term = useDebounced(search.trim());

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
    q: term,
    page,
    pageSize,
  });

  // The headline follows the FROM lens and nothing else — see useRestockInbound for why the status tabs deliberately do
  // not move it. It is always the queue still to do — ongoing and arrived — so switching to Accepted shows what has been
  // done beneath a headline of what has not.
  const inbound = useRestockInbound({ teamId, requestingTeamId: requesterFilter });

  // Every team type, not just SELLING: a root team can raise a restock too, and a "From" column that silently failed to
  // name one would read as a missing team rather than an unfiltered lookup.
  const teams = useTeams({ page: 1, pageSize: NAME_LOOKUP_SIZE, reference: true });

  const teamNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const team of teams.data?.teams ?? []) out[team.id.toString()] = team.name;
    return out;
  }, [teams.data]);

  const requests = query.data?.requests ?? [];
  // The couriers — a restock names a shipment channel by id; one read for the page.
  const couriers = useShipmentChannelsByIds(requests.map((r) => r.shipmentId));
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  // Always-fresh means every tab, page and filter change refetches; `listQuery` keeps the rows that are already up while
  // it does, and RefreshOverlay is what says so. `isPending` is excluded — a first load shows the skeleton instead.
  const refreshing = query.isFetching && !query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // Whether the range is still the one the screen opens on — the 7 days are where it starts, not a filter laid on it.
  const defaultRange = dateRangeCodec.encode(range) === dateRangeCodec.encode(DEFAULT_RANGE);

  // How many filters narrow the list — the phone's Filter count, and what puts Hapus Filter on screen. The date type and
  // the person's role alone narrow nothing: each says what its neighbour is about.
  const filtering =
    (search.trim() !== "" ? 1 : 0) +
    (requesterFilter !== 0n ? 1 : 0) +
    (actorId !== 0n ? 1 : 0) +
    (defaultRange ? 0 : 1);
  // What the rows on screen were asked with, which is what "nothing matches" is about.
  const narrowed = term !== "" || requesterFilter !== 0n || actorId !== 0n || !defaultRange;

  // Any change to a filter restarts at page 1 — the page number belongs to the OLD question, and page 5 of "everyone" is
  // very likely past the end of "Bandung only".
  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  // Every filter back to its start — the strip's Clear and a no-match hint's, one function. The tab stays: it is the
  // status being read, not a filter laid over it.
  const clearFilters = () =>
    refilter(() => {
      setSearch("");
      setRequesterFilter(0n);
      setActorRole("created");
      setActorId(0n);
      setRange(DEFAULT_RANGE);
      setDateField(RestockDateField.CREATED);
    });

  const open = (request: RestockRequest) => navigate(`/inventories/restock/${request.id}`);

  function teamLabel(id: bigint): string {
    return teamNames[id.toString()] ?? t("restock.teamRef", { id: id.toString() });
  }

  // Who did it — a NAME, a cell has room for nothing more. 0 is "not recorded", and the honest answer there is nothing.
  function actorLabel(id: bigint): string {
    if (id === 0n) return "";
    const user = query.data?.actors?.get(id.toString());

    return user ? user.name || user.username : t("restock.table.userRef", { id: id.toString() });
  }

  // FROM: THE TEAM, THEN WHO RAISED IT, SMALL UNDER IT (owner: *"dari itu team besar lalu usernya kecil di bawah"*,
  // the-inbound-row-says-who-and-when) — one context, two lines: which team sent it, and the person there to ask.
  function fromCell(request: RestockRequest) {
    const by = actorLabel(request.createdByUserId);

    return (
      <Stack gap="0" minW="0">
        <Span lineClamp={1}>{teamLabel(request.requestingTeamId)}</Span>
        {by && (
          <Span fontSize="xs" color="fg.muted" lineClamp={1} data-testid={`restock-created-by-${request.id}`}>
            {t("restock.table.by", { name: by })}
            {/* The "by Root team" badge when Root raised it from outside the team (an-override-shows-a-platform-badge) —
                after the name, on its line. */}
            {request.createdByIsOverride && <RootTeamBadge size="xs" ms="1.5" />}
          </Span>
        )}
      </Stack>
    );
  }

  // A DATE CELL — short, with its time, Jakarta's (a-table-date-is-short-and-every-time-is-wib); who did it small under
  // it when it is worth saying, with the "by Root team" badge after the name when Root did it from outside the team
  // (an-override-shows-a-platform-badge) — on the same line. A dash until it happens.
  function whenCell(unix: bigint, userId: bigint, testId: string, isOverride = false) {
    if (unix <= 0n)
      return (
        <Span color="fg.muted" data-testid={testId}>
          —
        </Span>
      );
    const by = actorLabel(userId);

    return (
      <Stack gap="0" data-testid={testId}>
        <Span fontSize="xs" whiteSpace="nowrap">
          {formatUnixDateTimeShort(unix)}
        </Span>
        {by && (
          <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={`${testId}-by`}>
            {t("restock.table.by", { name: by })}
            {isOverride && <RootTeamBadge size="xs" ms="1.5" />}
          </Span>
        )}
      </Stack>
    );
  }

  // The warehouse's OWN count is what produced this gap, so it belongs on its list too — the record of what it reported
  // at the door. Only ever on a counted row: an uncounted box is not a short one.
  function missingBadge(request: RestockRequest) {
    const missing = shortfall(request);
    if (missing <= 0n) return null;

    return (
      <Badge colorPalette="warning" data-testid={`restock-missing-${request.id}`}>
        {t("restock.table.missingBadge", { count: Number(missing) })}
      </Badge>
    );
  }

  // The courier and the tracking number — how the box is found at the door (a-restock-carries-its-tracking-number). The
  // number is copyable: it is typed into the courier's tracking page.
  function shipment(request: RestockRequest) {
    const receipt = request.receipt.trim();

    return (
      <Stack gap="0" align="start" minW="0">
        <ShipmentChannelBadge
          channelId={request.shipmentId}
          channel={couriers.data?.get(request.shipmentId.toString())}
        />
        {receipt !== "" && (
          <CopyText value={receipt} mono maxW="10rem" testId={`restock-receipt-${request.id}`} />
        )}
      </Stack>
    );
  }

  // The row's acts at the door — never more than two, so they stay NAMED (an unlabelled icon in the last column is one
  // nobody finds). Accepting is counting, placing and pricing, so it opens the Accept page; signing for the box confirms
  // first, because it cannot be taken back. Stops the row's navigate from firing when one is used.
  function rowActions(request: RestockRequest) {
    if (teamId === undefined) return null;

    return (
      <Box display="inline-flex" onClick={(e) => e.stopPropagation()}>
        <WarehouseRestockActions
          request={request}
          teamId={teamId}
          variant="row"
          codMark={<NotImplemented list={RESTOCK_INBOUND_PENDING} id="arrivalCod" />}
        />
      </Box>
    );
  }

  // A restock can be ticked when it has labels — when Cetak is one of its acts (WarehouseRestockActions holds which).
  const printable = (request: RestockRequest) => warehouseActions(request.status).includes("labels");
  const printableOnPage = requests.filter(printable).map((r) => r.id.toString());
  const allOnPage = printableOnPage.length > 0 && printableOnPage.every((id) => picked.includes(id));
  const someOnPage = printableOnPage.some((id) => picked.includes(id));
  // The head's box ticks this page's restocks up to the limit — so a third page of 20 adds 10 — and, when every one of
  // them is ticked or the limit is reached, un-ticks this page's instead.
  const headOff = printableOnPage.length === 0 || (full && !someOnPage);
  const toggleAllOnPage = () =>
    setPicked((prev) => {
      if (allOnPage || prev.length >= LABELS_MAX_RESTOCKS) return prev.filter((id) => !printableOnPage.includes(id));
      const room = LABELS_MAX_RESTOCKS - prev.length;
      return [...prev, ...printableOnPage.filter((id) => !prev.includes(id)).slice(0, room)];
    });

  // One row's box — disabled, with no word about it, for a restock that has no labels. It stops the row's navigate:
  // ticking a box must not open the restock.
  function pickBox(request: RestockRequest) {
    const id = request.id.toString();

    return (
      <Box display="inline-flex" onClick={(e) => e.stopPropagation()}>
        <Checkbox.Root
          size="sm"
          checked={picked.includes(id)}
          disabled={!printable(request) || (full && !picked.includes(id))}
          onCheckedChange={() => togglePick(id)}
          aria-label={t("restock.inbound.pickOne", { id })}
          data-testid={`restock-pick-${id}`}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
        </Checkbox.Root>
      </Box>
    );
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

  const oldestUnix = inbound.data?.oldestPendingUnix ?? 0n;
  // ⚠ SAMPLE — nothing sums the COD yet (pending.ts).
  const cod = sampleCodPaid(current.teamId);
  const oldestDays = daysSinceUnix(oldestUnix);

  function list() {
    if (requests.length === 0 && !error) {
      // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint) — nothing matches: clear the filters; an empty tab:
      // which status has none; nothing yet: where restocks come from. No action then — a warehouse does not raise one.
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
            testId="restock-inbound-empty"
          />
        );
      }

      const wholeList = activeTab.status === RestockRequestStatus.UNSPECIFIED;

      return (
        <EmptyHint
          icon={PackageOpen}
          title={
            wholeList
              ? t("restock.inbound.empty")
              : t("restock.emptyFiltered", { status: t(activeTab.labelKey).toLowerCase() })
          }
          description={wholeList ? t("restock.inbound.emptyHint") : undefined}
          testId="restock-inbound-empty"
        />
      );
    }

    if (isMobile) {
      // A PHONE READS EACH RESTOCK AS A BLOCK (a-phone-reads-each-line-as-a-block):
      //
      //   #501 [Dalam Perjalanan] [2 kurang]              29 Okt 13:05     which, where it has got to, when
      //   Toko Melati                                                      from whom
      //   [JNE] JNE0123456789 ⧉                                            how the box is found at the door
      //   SKU-BERAS-5K +2 lainnya · 3 produk                               what is in it
      //                                      [Tandai Tiba] [Terima]        the acts at the door, named
      return (
        <Stack gap="3" data-testid="restock-inbound-table">
          {requests.map((request) => (
            <Stack
              key={request.id.toString()}
              data-testid={`restock-row-${request.id}`}
              borderWidth="1px"
              borderRadius="md"
              p="4"
              gap="2"
              // It opens the restock, so it lights up and gives a little under a thumb (a-table-row-lights-up).
              {...PRESSABLE}
              onClick={() => open(request)}
            >
              <Flex align="center" gap="2" wrap="wrap">
                {pickBox(request)}
                <Text fontWeight="bold" data-testid={`restock-open-${request.id}`}>
                  #{request.id.toString()}
                </Text>
                <RestockStatusBadge status={request.status} />
                {missingBadge(request)}
                <Text fontSize="xs" color="fg.muted" ms="auto" whiteSpace="nowrap">
                  {formatUnixDateTimeShort(request.createdAtUnix)}
                </Text>
              </Flex>
              <Text
                fontSize="sm"
                // Root's restock from outside: the line may take two rows rather than cut the badge off.
                {...(request.createdByIsOverride ? { lineClamp: 2 } : { truncate: true })}
                data-testid={`restock-from-${request.id}`}
              >
                {teamLabel(request.requestingTeamId)}
                {actorLabel(request.createdByUserId) && (
                  <Span fontSize="xs" color="fg.muted" data-testid={`restock-created-by-${request.id}`}>
                    {" · "}
                    {t("restock.table.by", { name: actorLabel(request.createdByUserId) })}
                    {request.createdByIsOverride && <RootTeamBadge size="xs" ms="1.5" />}
                  </Span>
                )}
              </Text>
              {request.arrivedAtUnix > 0n && (
                <Text fontSize="xs" color="fg.muted" data-testid={`restock-arrived-${request.id}`}>
                  {t("restock.table.arrived")} {formatUnixDateTimeShort(request.arrivedAtUnix)}
                </Text>
              )}
              <Box onClick={(e) => e.stopPropagation()}>{shipment(request)}</Box>
              <Box onClick={(e) => e.stopPropagation()}>
                <RestockItemsCell items={request.items} showPrices={false} />
              </Box>
              {warehouseActions(request.status).length > 0 && (
                <Flex justify="end" pt="1">
                  {rowActions(request)}
                </Flex>
              )}
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      // Six columns may not fit every window — the table scrolls inside its own box, never the page.
      <Box overflowX="auto" w="full" maxW="full" minW="0">
        <Table.Root size="sm" data-testid="restock-inbound-table">
          <Table.Header>
            <Table.Row>
              {/* Every restock on this page that has labels — all, some (a dash), or none ticked. */}
              <Table.ColumnHeader width="1">
                <Checkbox.Root
                  size="sm"
                  checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
                  disabled={headOff}
                  onCheckedChange={toggleAllOnPage}
                  aria-label={t("restock.inbound.pickAll")}
                  data-testid="restock-pick-all"
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                </Checkbox.Root>
              </Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.restock")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.from")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.product")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.shipment")}</Table.ColumnHeader>
              {/* THE STATUS BEFORE THE DATES (owner: *"status sebelum tanggal"*, the-inbound-status-sits-before-its-dates)
                  — where it has got to, then when it got there; the selling list's order. */}
              <Table.ColumnHeader>{t("restock.table.status")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.created")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("restock.table.arrived")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("restock.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {requests.map((request) => (
              <Table.Row
                key={request.id.toString()}
                data-testid={`restock-row-${request.id}`}
                cursor="pointer"
                css={LIGHTS_UP}
                onClick={() => open(request)}
              >
                <Table.Cell>{pickBox(request)}</Table.Cell>
                {/* The number alone — when it was raised has its own column now (the-inbound-row-says-who-and-when). */}
                <Table.Cell data-testid={`restock-open-${request.id}`}>
                  <Span fontWeight="medium">#{request.id.toString()}</Span>
                </Table.Cell>
                <Table.Cell minW="36" data-testid={`restock-from-${request.id}`}>
                  {fromCell(request)}
                </Table.Cell>
                <Table.Cell onClick={(e) => e.stopPropagation()}>
                  {/* Unpriced here, deliberately — see the money note in this page's header comment. The warehouse's
                      DETAIL page still prices the same lines. */}
                  <RestockItemsCell items={request.items} showPrices={false} />
                </Table.Cell>
                <Table.Cell onClick={(e) => e.stopPropagation()}>{shipment(request)}</Table.Cell>
                <Table.Cell>
                  <Stack gap="1" align="start">
                    <RestockStatusBadge status={request.status} />
                    {missingBadge(request)}
                  </Stack>
                </Table.Cell>
                {/* CREATED AND ARRIVED (owner: *"ada tanggal dibuat dan sampai"*) — when it was raised (who raised it is
                    under the team), and when the box reached the door with who signed for it. */}
                <Table.Cell>{whenCell(request.createdAtUnix, 0n, `restock-created-${request.id}`)}</Table.Cell>
                <Table.Cell>
                  {whenCell(
                    request.arrivedAtUnix,
                    request.arrivedByUserId,
                    `restock-arrived-${request.id}`,
                    request.arrivedByIsOverride,
                  )}
                </Table.Cell>
                <Table.Cell textAlign="end">{rowActions(request)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    );
  }

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="restock-inbound-page">
      {/* THE PAGE NAMES ITSELF (the-desktop-shell-has-no-top-bar). No team badge (owner, 2026-07-30): the switcher names
          the team. No "New Restock": a warehouse does not order goods for itself — it receives what a selling team
          bought (#105). */}
      <Flex align="flex-start" gap="card">
        <Stack gap="0" flex="1" minW="0">
          <Heading size="md">{t("restock.inbound.title")}</Heading>
          <Text fontSize="sm" color="fg.muted">
            {t("restock.inbound.subtitle")}
          </Text>
        </Stack>

        {/* THE TICKED RESTOCKS, PRINTED AT ONCE (the-list-prints-the-ticked-restocks) — only while any is ticked. On a
            phone its icon (a-phone-header-action-is-an-icon); the ✕ un-ticks them all. */}
        {picked.length > 0 &&
          (isMobile ? (
            <CompactActions
              menuLabel={t("restock.table.actions")}
              actions={[
                {
                  id: "print",
                  label: t("restock.inbound.printPicked", { count: picked.length }),
                  icon: Printer,
                  primary: true,
                  testId: "restock-print-picked",
                  onClick: printPicked,
                },
                {
                  id: "clear",
                  label: t("restock.inbound.clearPicked"),
                  icon: X,
                  testId: "restock-pick-clear",
                  onClick: () => setPicked([]),
                },
              ]}
            />
          ) : (
            <Flex align="center" gap="1" flexShrink={0} animationStyle="appear">
              <Button colorPalette="brand" onClick={printPicked} data-testid="restock-print-picked">
                <Icon as={Printer} boxSize="4" />
                {t("restock.inbound.printPicked", { count: picked.length })}
              </Button>
              <IconButton
                variant="ghost"
                aria-label={t("restock.inbound.clearPicked")}
                title={t("restock.inbound.clearPicked")}
                onClick={() => setPicked([])}
                data-testid="restock-pick-clear"
              >
                <Icon as={X} boxSize="4" />
              </IconButton>
            </Flex>
          ))}
      </Flex>

      {/* AT THE LIMIT (at-most-fifty-restocks-a-print) — the boxes not ticked are off, and this says why. */}
      {full && (
        <Text fontSize="xs" color="fg.muted" mt="-3" textAlign={isMobile ? "start" : "end"} data-testid="restock-pick-full">
          {t("restock.inbound.pickFull", { max: LABELS_MAX_RESTOCKS })}
        </Text>
      )}

      {/* What is not real yet — the COD figure; the queue itself is. */}
      <NotImplementedSummary list={RESTOCK_INBOUND_PENDING} />

      {/* WHAT IS STILL TO DO (owner) — the order list's card strip (a-list-summary-is-the-order-lists-card-strip).
          Server-side totals over every restock targeting this warehouse that is ON ITS WAY OR AT THE DOOR, so they
          describe the queue rather than the visible page. THE COARSEST COUNT LEADS — how many deliveries, which is what a
          shift is planned by; the rest break the same queue down into products and pieces, and its oldest. */}
      <SummaryStrip testId="restock-inbound-summary">
        <SummaryCard
          emphasis
          label={t("restock.stat.inboundRestocks")}
          value={(inbound.data?.restockCount ?? 0n).toString()}
          note={t("restock.inbound.restocksHint")}
          testId="restock-stat-restocks"
        />
        <SummaryCard
          label={t("restock.stat.inboundProducts")}
          value={(inbound.data?.productCount ?? 0n).toString()}
          note={t("restock.stat.inboundProductsHint")}
          testId="restock-stat-products"
        />
        <SummaryCard
          label={t("restock.stat.inboundUnits")}
          value={(inbound.data?.unitCount ?? 0n).toString()}
          note={t("restock.stat.inboundUnitsHint")}
          testId="restock-stat-units"
        />
        {/* THE AGE, not the date, is the value — "3 days" is the thing worth acting on. The date it was raised goes
            under it, because that is what someone chases it by — data a phone keeps. An empty queue has no oldest. */}
        <SummaryCard
          label={t("restock.stat.oldestPending")}
          value={
            oldestUnix > 0n ? (
              <Span color={oldestDays >= 3 ? "error.fg" : undefined}>
                {t("restock.stat.oldestDays", { count: oldestDays })}
              </Span>
            ) : (
              "—"
            )
          }
          line={oldestUnix > 0n ? <Span data-testid="restock-stat-oldest-date">{formatUnixDate(oldestUnix)}</Span> : undefined}
          testId="restock-stat-oldest"
        />
        {/* THE COD IT PAID (the-warehouse-sees-the-cod-it-paid) — the courier's charge handed over at the door on the
            restocks it accepted this month, owed back by the selling teams. Not the queue, so last; a SAMPLE until a read
            sums it (pending.ts). */}
        <SummaryCard
          label={t("restock.stat.codPaid")}
          mark={<NotImplemented list={RESTOCK_INBOUND_PENDING} id="cod" />}
          value={formatRupiahNumber(cod.amount)}
          line={t("restock.stat.codPaidLine", { count: cod.restocks })}
          note={t("restock.stat.codPaidNote")}
          testId="restock-stat-cod"
        />
      </SummaryStrip>

      {/* THE SHARED FILTER STRIP (a-phone-filters-from-a-sheet, clear-filters-is-red-and-bold, every-filter-clears-from-
          its-own-x) — the search stays in the row on a phone; the rest are in the sheet. */}
      <FilterBar testId="restock-inbound-filter" active={filtering > 0} count={filtering} onClear={clearFilters}>
        <FilterSearch
          value={search}
          onChange={(value) => refilter(() => setSearch(value))}
          placeholder={t("restock.selling.searchPlaceholder")}
          testId="restock-inbound-search"
        />
        {/* WHO THE GOODS ARE COMING FROM — SELLING teams only (owner): buying is what a selling team does. A restock raised
            by the ROOT team still appears in the table but cannot be picked here. Every option is a selling team, so the
            pick is its name alone (a-one-type-picker-shows-the-name-alone). This lens narrows the cards above as well as
            the table, because it restates the question rather than picking rows out of an answer. */}
        <FilterField w="15rem" testId="restock-inbound-from">
          <TeamSelect
            value={requesterFilter > 0n ? requesterFilter : undefined}
            teamType={TeamType.SELLING}
            showType={false}
            placeholder={t("restock.inbound.fromAll")}
            onChange={(id) => refilter(() => setRequesterFilter(id))}
          />
        </FilterField>
        {/* BY PERSON — the role and the picker read as ONE control (owner), in one bordered group: [ Dibuat oleh ▾ │ person ].
            THE ROLE DECIDES WHO IS OFFERED: the people who did THAT on this warehouse's restocks
            (a-who-filter-lists-the-people-on-its-rows). Switching the role CLEARS the person — the people valid for one
            role are mostly invalid for the other. "Counted by" implies an accepted restock, so with Ongoing it is empty. */}
        <FilterField w="22rem" testId="restock-inbound-person">
          <Flex borderWidth="1px" borderColor="border" borderRadius="l2" overflow="hidden" align="stretch" w="full">
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="ghost" borderRadius="0" flexShrink="0" data-testid="restock-inbound-actor-role">
                  <Text truncate>
                    {actorRole === "created" ? t("restock.inbound.actorCreated") : t("restock.inbound.actorAccepted")}
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
                        {role === "created" ? t("restock.inbound.actorCreated") : t("restock.inbound.actorAccepted")}
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>

            <Box borderRightWidth="1px" borderColor="border" />

            <Box flex="1" minW="0">
              <PersonFilterSelect
                // Remounted per role so the combobox drops the previous role's people.
                key={actorRole}
                flush
                people={actorPeople.data}
                error={actorPeople.isError}
                value={actorId > 0n ? actorId : undefined}
                placeholder={t("restock.inbound.actorAll")}
                // A cleared picker emits undefined → 0n, "anyone" — the filter is removed, not stuck.
                onChange={(id) => refilter(() => setActorId(id ?? 0n))}
              />
            </Box>
          </Flex>
        </FilterField>
        {/* WHICH DATE, THEN WHICH WINDOW — one panel (a-date-type-is-picked-inside-the-range-panel). Opens on the last 7
            days — see DEFAULT_RANGE. */}
        <FilterField w="auto">
          <DateRangePicker
            value={range}
            onChange={(r) => refilter(() => setRange(r))}
            fields={RESTOCK_DATE_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
            field={dateField}
            onFieldChange={(v) => refilter(() => setDateField(v))}
            testId="restock-inbound-date"
          />
        </FilterField>
      </FilterBar>

      {/* One panel, whose value tracks the active tab: every tab shows the SAME list — only the `status` sent to the RPC
          differs. The row scrolls sideways on a phone rather than run past its edge (nothing-runs-past-a-phones-edge). */}
      <Tabs.Root value={tab} onValueChange={(e) => refilter(() => setTab(e.value))}>
        <Tabs.List flexWrap="nowrap" overflowX="auto" overflowY="hidden">
          {RESTOCK_STATUS_TABS.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} flexShrink={0} data-testid={`restock-tab-${item.value}`}>
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <Stack gap="section">
            {error && (
              <Text color="error.fg" data-testid="restock-inbound-error">
                {error}
              </Text>
            )}

            {/* THE FIRST LOAD SHOWS THE LIST'S SHAPE, and the rows fade in over it (motion-is-small-quick-and-shared).
                Once — a refresh keeps the rows mounted, so nothing fades again. */}
            {loading ? (
              <ListSkeleton testId="restock-inbound-loading" />
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
                requesterFilter,
                actorRole,
                actorId,
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
              testId="restock-inbound-pager"
            />
          </Stack>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
