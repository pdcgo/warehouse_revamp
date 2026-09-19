import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Icon,
  Input,
  SimpleGrid,
  Spacer,
  Stack,
  Stat,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { Undo2 } from "lucide-react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { useTeam } from "../../features/team/TeamContext";
import { TeamItem } from "../../components/entity/TeamItem";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { Pagination } from "../../components/chrome/Pagination";
import {
  ALL_DATES,
  DateRangePicker,
  isAllDates,
  resolveRange,
} from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { formatRupiah } from "../../lib/money";

const PAGE_SIZE = 20;

// A return's lifecycle, mirroring the restock request (#163): created before its goods arrive
// (ONGOING — the in-flight state #144 asks about), then counted and inspected on RECEIVED, or
// CANCELLED if it never came. Whether "arrived, awaiting count" is a state distinct from ONGOING is
// an open fork (brainstorming §4.3) — until it is settled this list keeps the two-state model.
type ReturnStatus = "ongoing" | "received" | "cancelled" | "lost";

// The status filter is a row of TABS, not a dropdown (#130's pattern): "All" leads, then one tab per
// status in lifecycle order. The tab IS the filter — its `status` (""=every status) is the only thing
// that changes between tabs — so the tab string is the single source of truth and nothing can drift.
const STATUS_TABS: { value: string; labelKey: string; status: ReturnStatus | "" }[] = [
  { value: "all", labelKey: "returns.statusAll", status: "" },
  { value: "ongoing", labelKey: "returns.status.ongoing", status: "ongoing" },
  { value: "received", labelKey: "returns.status.received", status: "received" },
  { value: "cancelled", labelKey: "returns.status.cancelled", status: "cancelled" },
  { value: "lost", labelKey: "returns.status.lost", status: "lost" },
];

interface ReturnRow {
  id: string;
  code: string;
  createdUnix: number;
  // The order these goods were sold on. OPTIONAL (brainstorming §5.2) — a walk-in parcel can be
  // logged with none, and then there is no revenue to reduce.
  orderId?: number;
  // When that order was placed — a distinct date from the return's own timeline, so the date filter
  // can range on "order created" as well as "return created" / "accepted".
  orderCreatedUnix?: number;
  team: string;
  // The shop the order was placed on, and its marketplace (shown via the shared MarketplaceBadge).
  // Absent for a return with no order (a walk-in parcel).
  shop?: string;
  marketplace?: Marketplace;
  customer?: string;
  // The buyer's address — where the goods went (and, for an RTS, came back from). Shown under the
  // name so a return can be tied to a shipment without opening it.
  address?: string;
  // A free-text note about the return — whatever the person logging it wants to record. Not a fixed
  // set: the earlier "reason" enum was dropped in favour of a plain note (owner).
  note?: string;
  items: number;
  // The expected refund value in whole rupiah. The FINAL money settles on receipt, because it
  // depends on the condition of what actually arrived (brainstorming §4.2). Absent when unknown.
  valueRupiah?: bigint;
  // When the return was RECEIVED (counted & inspected) and who did it — only a received return has
  // these; an ongoing or cancelled one has not been accepted yet.
  acceptedUnix?: number;
  acceptedBy?: string;
  status: ReturnStatus;
}

// PREVIEW DATA. The return_service does not exist yet — this list is designed mock-first (#163) and
// wired to hardcoded rows so the screen can be reviewed in the running app. The backend + real query
// are tracked as a sub-issue of #163; when it lands this array is replaced by a paginated RPC.
const SAMPLE: ReturnRow[] = [
  { id: "1", code: "RTN-0142", createdUnix: 1769212800, orderId: 4127, orderCreatedUnix: 1768608000, team: "Selling Alpha", shop: "Alpha Store", marketplace: Marketplace.SHOPEE, customer: "Rina Wijaya", address: "Jl. Kenanga 12, Bandung", note: "Wrong item — ordered blue, got black", items: 1, valueRupiah: 145000n, status: "ongoing" },
  { id: "2", code: "RTN-0141", createdUnix: 1769212800, orderId: 4098, orderCreatedUnix: 1768608000, team: "Selling Beta", shop: "Beta Official", marketplace: Marketplace.TOKOPEDIA, customer: "Budi Santoso", address: "Jl. Melati 8, Surabaya", note: "Arrived damaged in transit", items: 2, valueRupiah: 90000n, status: "ongoing" },
  { id: "3", code: "RTN-0140", createdUnix: 1769126400, team: "Selling Alpha", note: "Unlabeled parcel — no order found", items: 1, status: "ongoing" },
  { id: "4", code: "RTN-0139", createdUnix: 1769126400, orderId: 4103, orderCreatedUnix: 1768521600, team: "Selling Alpha", shop: "Alpha Store", marketplace: Marketplace.SHOPEE, customer: "Sari Dewanti", address: "Jl. Anggrek 45, Jakarta Selatan", note: "Customer changed mind", items: 3, valueRupiah: 375000n, status: "ongoing" },
  { id: "5", code: "RTN-0138", createdUnix: 1769040000, orderId: 4071, orderCreatedUnix: 1768435200, team: "Selling Beta", shop: "Beta Official", marketplace: Marketplace.TIKTOK, customer: "Andi Pratama", address: "Jl. Cendana 3, Semarang", note: "Courier could not deliver (RTS)", items: 4, valueRupiah: 580000n, acceptedUnix: 1769126400, acceptedBy: "Rudi Hartono", status: "received" },
  { id: "6", code: "RTN-0137", createdUnix: 1768953600, orderId: 4055, orderCreatedUnix: 1768348800, team: "Selling Alpha", shop: "Alpha Mart", marketplace: Marketplace.TOKOPEDIA, customer: "Maya Lestari", address: "Jl. Mawar 21, Bekasi", note: "Defective — 1 back to shelf, 1 written off", items: 2, valueRupiah: 300000n, acceptedUnix: 1769040000, acceptedBy: "Siti Aminah", status: "received" },
  { id: "7", code: "RTN-0135", createdUnix: 1768780800, orderId: 4032, orderCreatedUnix: 1768176000, team: "Selling Alpha", shop: "Alpha Store", marketplace: Marketplace.LAZADA, customer: "Dewi Kartika", address: "Jl. Flamboyan 7, Depok", note: "Wrong size", items: 2, valueRupiah: 170000n, acceptedUnix: 1768867200, acceptedBy: "Rudi Hartono", status: "received" },
  { id: "8", code: "RTN-0136", createdUnix: 1768867200, orderId: 4048, orderCreatedUnix: 1768262400, team: "Selling Beta", shop: "Beta Official", marketplace: Marketplace.TOKOPEDIA, customer: "Tono Hidayat", address: "Jl. Dahlia 19, Sidoarjo", note: "Said would return, never arrived", items: 1, valueRupiah: undefined, status: "cancelled" },
  { id: "9", code: "RTN-0134", createdUnix: 1768694400, orderId: 4019, orderCreatedUnix: 1768089600, team: "Selling Beta", shop: "Beta Official", marketplace: Marketplace.TOKOPEDIA, customer: "Eka Putra", address: "Jl. Kamboja 5, Malang", note: "Shipped back but never arrived — presumed lost in transit", items: 2, valueRupiah: 240000n, status: "lost" },
];

const STATUS_PALETTE: Record<ReturnStatus, string> = {
  ongoing: "orange",
  received: "green",
  cancelled: "gray",
  lost: "red",
};

// The date range is paired with a FIELD (like the batches screen's Arrived/Expiring): the same
// window can range on a return's own timeline (created / accepted) or on the order it came from.
type DateField = "created" | "orderCreated" | "accepted";
const DATE_FIELDS: { value: DateField; labelKey: string; pick: (r: ReturnRow) => number | undefined }[] = [
  { value: "created", labelKey: "returns.dateField.created", pick: (r) => r.createdUnix },
  { value: "orderCreated", labelKey: "returns.dateField.orderCreated", pick: (r) => r.orderCreatedUnix },
  { value: "accepted", labelKey: "returns.dateField.accepted", pick: (r) => r.acceptedUnix },
];

function formatDateUnix(unix: number, lang: string): string {
  return new Date(unix * 1000).toLocaleDateString(lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ReturnsPage is the warehouse team's queue of goods coming BACK from a buyer (#163/#144) — a
// restock's mirror image. The job is to find an ONGOING return that has arrived and receive it:
// count what came, place the sellable, write off the broken. Backed by preview data pending the
// return_service (sub-issue of #163).
export function ReturnsPage() {
  const { current } = useTeam();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  // The shared TeamSelect / ShopSelect emit ids (a shop is scoped to its team). On this preview page
  // the rows are keyed by name, not id, so these filters are visual until the ReturnList RPC lands
  // (#229) — the search box still matches team/shop by text meanwhile.
  const [teamId, setTeamId] = useState(0n);
  const [shopId, setShopId] = useState(0n);
  const [range, setRange] = useState<DateRange>(ALL_DATES);
  const [dateField, setDateField] = useState<DateField>("created");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  // The active tab decides the status filter; "" means every status ("All").
  const status = STATUS_TABS.find((s) => s.value === tab)?.status ?? "";

  // Switching tab restarts at page 1 — the page number belongs to the old filter.
  function selectTab(next: string) {
    setTab(next);
    setPage(1);
  }

  // Header figures are over the WHOLE set (like the batches screen), so they answer "how much is in
  // flight" regardless of the filters below.
  const ongoing = SAMPLE.filter((r) => r.status === "ongoing");
  const ongoingValue = ongoing.reduce((sum, r) => sum + (r.valueRupiah ?? 0n), 0n);
  const receivedRecent = SAMPLE.filter(
    (r) => r.status === "received" && r.createdUnix * 1000 >= Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).length;

  const pickDate = DATE_FIELDS.find((f) => f.value === dateField)?.pick ?? ((r: ReturnRow) => r.createdUnix);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const { fromUnix, toUnix } = resolveRange(range);
    const from = Number(fromUnix);
    const to = Number(toUnix);
    return SAMPLE.filter((r) => {
      const hay = `${r.code} ${r.orderId ?? ""} ${r.customer ?? ""} ${r.team} ${r.shop ?? ""} ${r.address ?? ""} ${r.acceptedBy ?? ""} ${r.note ?? ""}`.toLowerCase();
      if (term && !hay.includes(term)) return false;
      if (status && r.status !== status) return false;
      // Team/shop come from the shared pickers as ids; the preview rows have no ids to match, so those
      // filters are inert here (see the state note). They bind for real with the ReturnList RPC.
      if (!isAllDates(range)) {
        // The range applies to the chosen field; a row with no such date drops out of an active range.
        const v = pickDate(r);
        if (v === undefined) return false;
        if (from && v < from) return false;
        if (to && v > to) return false;
      }
      return true;
    });
  }, [search, status, range, pickDate]);

  const total = filtered.length;
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("returns.title")}</Heading>
        <Text color="fg.muted">{t("returns.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("returns.title")}</Heading>
        <Text color="fg.muted" data-testid="returns-not-warehouse">
          {t("returns.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="returns-page">
      <Flex align="center" gap="card" wrap="wrap">
        {/* Honest label: the goods here are invented until the return_service lands (#163). */}
        <Badge colorPalette="gray" variant="surface" data-testid="returns-preview">
          {t("returns.preview")}
        </Badge>
        <Spacer />
        {/* Force Return — the warehouse starts a return itself (brainstorming §5.3): a parcel turned up,
            so log it and receive it in one motion rather than waiting for an "ongoing" one to arrive. */}
        <Button colorPalette="brand" data-testid="returns-force">
          <Icon as={Undo2} boxSize="4" />
          {t("returns.forceReturn")}
        </Button>
      </Flex>

      <SimpleGrid columns={{ base: 1, sm: 3 }} gap="card">
        <Stat.Root>
          <Stat.Label>{t("returns.statOngoing")}</Stat.Label>
          <Stat.ValueText color={ongoing.length > 0 ? "orange.fg" : undefined}>
            {ongoing.length}
          </Stat.ValueText>
          <Stat.HelpText>{t("returns.statOngoingHint")}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("returns.statOngoingValue")}</Stat.Label>
          <Stat.ValueText>{formatRupiah(ongoingValue)}</Stat.ValueText>
          <Stat.HelpText>{t("returns.statOngoingValueHint")}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("returns.statReceived")}</Stat.Label>
          <Stat.ValueText>{receivedRecent}</Stat.ValueText>
          <Stat.HelpText>{t("returns.statReceivedHint")}</Stat.HelpText>
        </Stat.Root>
      </SimpleGrid>

      <Flex gap="card" wrap="wrap" align="center">
        <Input
          maxW="sm"
          placeholder={t("returns.searchPlaceholder")}
          value={search}
          data-testid="returns-search"
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        {/* The shared team picker (searchable, scoped to selling teams — a return's goods belong to a
            selling team). It emits a team id; on this preview page it does not filter the rows yet. */}
        <Box maxW="56" w="full">
          <TeamSelect
            value={teamId > 0n ? teamId : undefined}
            teamType={TeamType.SELLING}
            placeholder={t("returns.teamAll")}
            onChange={(id) => {
              setTeamId(id);
              // A shop belongs to a team, so changing team clears any shop chosen under the old one.
              setShopId(0n);
              setPage(1);
            }}
          />
        </Box>
        {/* The shared shop picker — a shop is team-scoped, so it needs the chosen team and stays
            disabled until one is picked. */}
        <Box maxW="52" w="full">
          <ShopSelect
            teamId={teamId}
            value={shopId > 0n ? shopId : undefined}
            disabled={teamId === 0n}
            placeholder={t("returns.shopAll")}
            onChange={(id) => {
              setShopId(id);
              setPage(1);
            }}
          />
        </Box>
        {/* The range picker carries the time-type itself (#225): its `fields` segment chooses WHICH
            date the window filters on — return created / order created / accepted. */}
        <DateRangePicker
          value={range}
          onChange={(r) => {
            setRange(r);
            setPage(1);
          }}
          fields={DATE_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
          field={dateField}
          onFieldChange={(v) => {
            setDateField(v);
            setPage(1);
          }}
          testId="returns-date"
        />
        <Spacer />
      </Flex>

      {/* Status is a row of tabs (#130's pattern), not a filter dropdown: All, then one tab per
          status. The active tab is the only status filter — the table below it is otherwise the same. */}
      <Tabs.Root value={tab} onValueChange={(e) => selectTab(e.value)}>
        <Tabs.List>
          {STATUS_TABS.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} data-testid={`returns-tab-${item.value}`}>
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <Stack gap="card">
            <Table.Root size="sm" data-testid="returns-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("returns.colReturn")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("returns.colOrder")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("returns.colTeam")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("returns.colShop")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("returns.colCustomer")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("returns.colNote")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("returns.colItems")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("returns.colValue")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("returns.colCreated")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("returns.colAccepted")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("returns.colStatus")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {pageRows.map((r) => (
              <Table.Row
                key={r.id}
                data-testid={`returns-row-${r.code}`}
                cursor="pointer"
                _hover={{ bg: "bg.muted" }}
                onClick={() => navigate(`/inventories/returns/${r.id}`)}
              >
                <Table.Cell>
                  <Text as="span" fontWeight="medium" color={r.status === "cancelled" ? "fg.muted" : "brand.fg"}>
                    {r.code}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  {r.orderId ? (
                    <Text as="span">#{r.orderId}</Text>
                  ) : (
                    <Text as="span" color="fg.subtle">
                      {t("returns.noOrder")}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {/* The catalogue owner, shown the shared way (TeamItem) — these are selling teams. */}
                  <TeamItem team={{ teamName: r.team, teamType: TeamType.SELLING }} />
                </Table.Cell>
                <Table.Cell>
                  {r.shop ? (
                    <Stack gap="0.5" alignItems="flex-start">
                      <Text as="span">{r.shop}</Text>
                      {r.marketplace !== undefined && (
                        <MarketplaceBadge marketplace={r.marketplace} size="sm" />
                      )}
                    </Stack>
                  ) : (
                    <Text as="span" color="fg.subtle">
                      —
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {r.customer ? (
                    <Stack gap="0.5">
                      <Text as="span">{r.customer}</Text>
                      {r.address && (
                        <Text as="span" color="fg.subtle" fontSize="xs">
                          {r.address}
                        </Text>
                      )}
                    </Stack>
                  ) : (
                    <Text as="span" color="fg.subtle">
                      —
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell maxW="64" truncate>
                  {r.note ? (
                    <Text as="span" color="fg.muted">
                      {r.note}
                    </Text>
                  ) : (
                    <Text as="span" color="fg.subtle">
                      —
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell textAlign="end">{r.items}</Table.Cell>
                <Table.Cell textAlign="end">
                  {r.valueRupiah !== undefined ? (
                    formatRupiah(r.valueRupiah)
                  ) : (
                    <Text as="span" color="fg.subtle">
                      —
                    </Text>
                  )}
                </Table.Cell>
                {/* When it was created (the ongoing clock starts here). */}
                <Table.Cell whiteSpace="nowrap">{formatDateUnix(r.createdUnix, i18n.language)}</Table.Cell>
                {/* When it was received/inspected, and by whom — only a received return has these. */}
                <Table.Cell whiteSpace="nowrap">
                  {r.acceptedUnix !== undefined ? (
                    <Stack gap="0.5">
                      <Text as="span">{formatDateUnix(r.acceptedUnix, i18n.language)}</Text>
                      {r.acceptedBy && (
                        <Text as="span" color="fg.subtle" fontSize="xs">
                          {t("returns.acceptedBy", { name: r.acceptedBy })}
                        </Text>
                      )}
                    </Stack>
                  ) : (
                    <Text as="span" color="fg.subtle">
                      —
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Badge colorPalette={STATUS_PALETTE[r.status]}>{t(`returns.status.${r.status}`)}</Badge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>

        {total === 0 ? (
          <Text color="fg.muted" data-testid="returns-empty">
            {t("returns.empty")}
          </Text>
        ) : (
              <Pagination
                page={page}
                pageSize={pageSize}
                count={total}
                onPageChange={setPage}
                pageSizeOptions={[10, 20, 50]}
                onPageSizeChange={(size) => {
                  setPageSize(size);
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
