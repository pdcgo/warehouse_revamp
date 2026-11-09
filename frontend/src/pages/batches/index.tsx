import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, Flex, Heading, Span, Stack, Table, Text } from "@chakra-ui/react";
import { Layers, SearchX } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { StockBatch } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { BatchDateField, BatchExpiryFilter } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useWarehouseBatches } from "../../features/inventory/queries";
import { BatchExplainer } from "../../features/inventory/BatchExplainer";
import { BatchSource } from "../../features/inventory/BatchSource";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { CopyText } from "../../components/chrome/CopyText";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { TeamItem } from "../../components/entity/TeamItem";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { ALL_DATES, DateRangePicker, isAllDates, resolveRange } from "../../components/datetime/DateRangePicker";
import { useIsMobile } from "../../layouts/shell";
import { fromHere } from "../../lib/cameFrom";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import { PRESSABLE } from "../../lib/motion";
import { useDebounced } from "../../lib/useDebounced";
import { dateRangeCodec, enumCodec, idCodec, textCodec, useUrlState } from "../../lib/urlState";
import { ExpiryCell } from "./components/ExpiryCell";
import { ExpirySelect } from "./components/ExpirySelect";
import { BATCH_LIST_PENDING } from "./pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

const EXPIRY_CODEC = enumCodec<number>([
  BatchExpiryFilter.UNSPECIFIED,
  BatchExpiryFilter.EXPIRING_SOON,
  BatchExpiryFilter.NO_EXPIRY,
]);
const DATE_FIELD_CODEC = enumCodec<number>([BatchDateField.ARRIVED, BatchDateField.EXPIRING]);


// BatchesPage is the warehouse-wide list of every stock batch (#209) — a cost layer per delivery line,
// browsable by receipt/batch number and by expiry, so a manager can find what is running out.
//
// ON THE SCREEN RULES (owner: *"inisiasi dan kasih keterangan batch itu apa"*, the-batches-follow-the-screen-rules):
//
//   Batch
//   Stok yang masuk bersamaan dengan harga yang sama — satu per produk di tiap restok yang diterima.
//   [ⓘ Apa itu batch? ⌄]                                                          ← a-batch-says-what-it-is
//   [Batch 6] [Nilai siap Rp 1.993.900] [Kedaluwarsa ≤ 30 hari 2]                 ← the card strip
//   [⌕ Cari batch, resi, atau produk] [Semua tim ⌄] ⚠2 [Semua kedaluwarsa ⌄] [Tiba · semua tanggal]
//   Batch            Produk              Tim             Tiba          Siap  Biaya/pcs  Nilai siap  Kedaluwarsa
//   #5031            Beras Pandan …      [TM] Melati     1 Nov 13:05     7  Rp 66.167  Rp 463.169  27 Nov
//   Restok #503 · …  SKU-BERAS-5K
//
// On a phone the filters are a sheet and each batch is a block.
export function BatchesPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  // THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh, or Back from a batch, opens the same
  // narrowed list.
  const [search, setSearch] = useUrlState("q", "", textCodec);
  // Whose goods — held and thrown away until the list can ask for a team (pending.ts, teamFilter).
  const [teamId, setTeamId] = useUrlState("team", 0n, idCodec);
  const [expiry, setExpiry] = useUrlState("expiry", BatchExpiryFilter.UNSPECIFIED, EXPIRY_CODEC);
  const [dateField, setDateField] = useUrlState("date", BatchDateField.ARRIVED, DATE_FIELD_CODEC);
  const [dateRange, setDateRange] = useUrlState("range", ALL_DATES, dateRangeCodec);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Typed, then settled — a word is one request to the server, not one per key.
  const term = useDebounced(search.trim());
  const { fromUnix, toUnix } = resolveRange(dateRange);
  const query = useWarehouseBatches({
    warehouseId,
    search: term,
    supplierId: 0n,
    expiry,
    // A range with no bound chosen applies to nothing, so send UNSPECIFIED unless a bound is set.
    dateField: isAllDates(dateRange) ? BatchDateField.UNSPECIFIED : dateField,
    fromUnix,
    toUnix,
    page,
    pageSize,
  });
  const res = query.data?.res;
  const teamByProduct = query.data?.teamByProductId;
  const batches = res?.batches ?? [];
  const total = Number(res?.pageInfo?.totalItems ?? 0n);
  const loading = query.isPending;
  const expiring = res?.expiringSoonCount ?? 0n;

  // How many filters narrow the list — the phone's Filter count, and what puts Hapus Filter on screen.
  const filtering =
    (search.trim() !== "" ? 1 : 0) +
    (teamId !== 0n ? 1 : 0) +
    (expiry !== BatchExpiryFilter.UNSPECIFIED ? 1 : 0) +
    (isAllDates(dateRange) ? 0 : 1);

  // Any change to a filter restarts at page 1 — the page number belongs to the old question.
  const refilter = (apply: () => void) => {
    apply();
    setPage(1);
  };
  const clearFilters = () =>
    refilter(() => {
      setSearch("");
      setTeamId(0n);
      setExpiry(BatchExpiryFilter.UNSPECIFIED);
      setDateRange(ALL_DATES);
      setDateField(BatchDateField.ARRIVED);
    });

  // A batch's page, carrying this list — so its back returns here with the filters (a-form-returns-where-it-was-opened).
  const open = (b: StockBatch) => navigate(`/inventories/batches/${b.id}`, { state: fromHere(location) });

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batches.title")}</Heading>
        <Text color="fg.muted">{t("batches.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batches.title")}</Heading>
        <Text color="fg.muted" data-testid="batches-not-warehouse">
          {t("batches.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  // WHICH BATCH, AND WHERE IT CAME FROM — its own number (the one in a label's QR), and under it the restock it was
  // minted from as a link to it, or that it was a return (a-batch-opens-where-it-came-from). No resi: it is the
  // restock's. One context: the batch's identity is its source.
  function batchCell(b: StockBatch) {
    return (
      <Stack gap="0" minW="0">
        <Text fontWeight="bold" data-testid={`batches-number-${b.id}`}>
          #{b.id.toString()}
        </Text>
        <Text as="span" fontSize="xs" color="fg.muted">
          <BatchSource batch={b} testId={`batches-source-${b.id}`} />
        </Text>
      </Stack>
    );
  }

  // WHOSE GOODS (a-team-of-a-known-type-shows-no-badge) — a batch's owner is always a selling team, so its type badge
  // said nothing: the small avatar and the name alone.
  const team = (b: StockBatch) => {
    const owner = teamByProduct?.get(b.productId.toString());
    return owner ? (
      <Box data-testid={`batches-team-${b.id}`} minW="0">
        <TeamItem
          size="xs"
          team={{ teamId: owner.id, teamName: owner.name, teamType: owner.type, imageUrl: owner.imageUrl }}
        />
      </Box>
    ) : (
      <Text color="fg.muted">—</Text>
    );
  };

  const money = (b: StockBatch, v: number) => (b.costKnown ? formatRupiah(v) : t("batches.costUnknown"));

  // READY — what is left of the batch; at 0 it says so (a depleted batch keeps its row: its history is still there).
  const ready = (b: StockBatch) => (
    <Stack gap="1" align="end">
      <Text fontWeight="bold" data-testid={`batches-ready-${b.id}`}>
        {b.ready.toString()}
      </Text>
      {b.ready === 0n && (
        <Badge colorPalette="gray" data-testid={`batches-depleted-${b.id}`}>
          {t("batches.depleted")}
        </Badge>
      )}
    </Stack>
  );

  function list() {
    if (batches.length === 0 && !query.isError) {
      // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint) — nothing matches: clear the filters; none at all:
      // where batches come from.
      return filtering > 0 ? (
        <EmptyHint
          icon={SearchX}
          title={t("batches.empty")}
          description={t("emptyHint.noMatch")}
          action={
            <Button variant="outline" colorPalette="gray" onClick={clearFilters}>
              {t("common.clearFilters")}
            </Button>
          }
          testId="batches-empty"
        />
      ) : (
        <EmptyHint icon={Layers} title={t("batches.none")} description={t("batches.noneHint")} testId="batches-empty" />
      );
    }

    if (isMobile) {
      // A PHONE READS EACH BATCH AS A BLOCK (a-phone-reads-each-line-as-a-block):
      //
      //   #5031 [Habis]                                 1 Nov 13:05
      //   Beras Pandan Wangi 5kg · SKU-BERAS-5K
      //   [TM] Toko Melati
      //   Siap 7 · Rp 66.167 × 7 … Rp 463.169
      //   Restok #503 · SCP…                    Kedaluwarsa 27 Nov
      return (
        <Stack gap="3" data-testid="batches-table">
          {batches.map((b) => (
            <Stack
              key={b.id.toString()}
              data-testid={`batches-row-${b.id}`}
              borderWidth="1px"
              borderRadius="md"
              p="4"
              gap="2"
              // It opens the batch, so it lights up and gives a little under a thumb (a-table-row-lights-up).
              {...PRESSABLE}
              onClick={() => open(b)}
            >
              <Flex align="center" gap="2">
                <Text fontWeight="bold" data-testid={`batches-number-${b.id}`}>
                  #{b.id.toString()}
                </Text>
                {b.ready === 0n && (
                  <Badge colorPalette="gray" data-testid={`batches-depleted-${b.id}`}>
                    {t("batches.depleted")}
                  </Badge>
                )}
                <Text fontSize="xs" color="fg.muted" ms="auto" whiteSpace="nowrap">
                  {formatUnixDateTimeShort(b.createdAtUnix)}
                </Text>
              </Flex>
              <Stack gap="0" minW="0">
                <Text fontSize="sm" truncate>
                  {b.name}
                </Text>
                <Text as="span" fontSize="xs" color="fg.muted">
                  <CopyText value={b.productCode} fontSize="xs" testId={`batches-sku-${b.id}`} />
                </Text>
              </Stack>
              {team(b)}
              <Text fontSize="sm">
                {t("batches.colReady")}{" "}
                <Span fontWeight="bold" data-testid={`batches-ready-${b.id}`}>
                  {b.ready.toString()}
                </Span>
                <Span color="fg.muted">{` · ${money(b, b.unitCost)} × ${b.ready.toString()} … `}</Span>
                <Span fontWeight="bold">{money(b, b.readyValue)}</Span>
              </Text>
              <Flex align="center" gap="2" fontSize="xs" color="fg.muted">
                <Text as="span" flex="1" minW="0">
                  <BatchSource batch={b} testId={`batches-source-${b.id}`} />
                </Text>
                {b.expiresOnUnix > 0n && (
                  <Text flexShrink={0}>
                    {t("batches.colExpiring")}{" "}
                    <ExpiryCell inline unix={b.expiresOnUnix} testId={`batches-expiry-${b.id}`} />
                  </Text>
                )}
              </Flex>
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      // Eight columns may not fit every window — the table scrolls inside its own box, never the page.
      <Box overflowX="auto" w="full" maxW="full" minW="0">
        <Table.Root size="sm" data-testid="batches-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("batches.colBatch")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("batches.colProduct")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("batches.colTeam")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("batches.colArrived")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("batches.colReady")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("batches.colCost")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("batches.colReadyValue")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("batches.colExpiring")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {batches.map((b) => (
              <Table.Row
                key={b.id.toString()}
                cursor="pointer"
                css={LIGHTS_UP}
                data-testid={`batches-row-${b.id}`}
                onClick={() => open(b)}
              >
                <Table.Cell>{batchCell(b)}</Table.Cell>
                {/* The product — its name, its SKU under it (one context, two lines); the SKU copies, without opening
                    the batch (sku-is-copyable). */}
                <Table.Cell maxW="56">
                  <Text lineClamp={1} title={b.name}>
                    {b.name}
                  </Text>
                  <Text as="span" fontSize="xs" color="fg.muted">
                    <CopyText value={b.productCode} fontSize="xs" testId={`batches-sku-${b.id}`} />
                  </Text>
                </Table.Cell>
                {/* The catalogue OWNER (#142) — a warehouse holds several teams' goods; shown the way a team is
                    shown everywhere (TeamItem). Distinct from the supplier who delivered them. */}
                <Table.Cell>{team(b)}</Table.Cell>
                {/* Arrived = when the batch was minted, which is when the delivery was accepted — short, with its time
                    (a-table-date-is-short-and-every-time-is-wib). */}
                <Table.Cell whiteSpace="nowrap" fontSize="xs">
                  {formatUnixDateTimeShort(b.createdAtUnix)}
                </Table.Cell>
                <Table.Cell textAlign="end">{ready(b)}</Table.Cell>
                <Table.Cell textAlign="end" whiteSpace="nowrap">
                  {money(b, b.unitCost)}
                </Table.Cell>
                <Table.Cell textAlign="end" whiteSpace="nowrap" fontWeight="bold">
                  {money(b, b.readyValue)}
                </Table.Cell>
                {/* KEDALUWARSA — the day alone and how long is left under it, the size of Tiba beside it
                    (an-expiry-says-how-long-is-left). */}
                <Table.Cell>
                  <ExpiryCell unix={b.expiresOnUnix} testId={`batches-expiry-${b.id}`} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    );
  }

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="batches-page">
      {/* THE PAGE NAMES ITSELF (the-desktop-shell-has-no-top-bar), with what a batch is in a line under it — and the
          whole answer one click away (a-batch-says-what-it-is). No team badge: the switcher names the team. */}
      <Stack gap="1">
        <Heading size="md">{t("batches.title")}</Heading>
        <Text fontSize="sm" color="fg.muted" data-testid="batches-subtitle">
          {t("batches.subtitle")}
        </Text>
        <Box ms="-1">
          <BatchExplainer />
        </Box>
      </Stack>

      {/* What is not wired yet — a return batch cannot open its return, and the team filter narrows nothing
          (pending.ts). */}
      <NotImplementedSummary list={BATCH_LIST_PENDING} />

      {/* THE FIGURES, the order list's card strip (a-list-summary-is-the-order-lists-card-strip) — over the whole
          filtered set, not the page: how many batches, what their ready units are worth, how many expire within 30
          days. */}
      <SummaryStrip testId="batches-summary">
        <SummaryCard
          emphasis
          label={t("batches.statBatches")}
          value={<Span data-testid="batches-stat-count">{loading ? "—" : total.toString()}</Span>}
          note={t("batches.statBatchesNote")}
          testId="batches-stat-batches"
        />
        <SummaryCard
          label={t("batches.statReadyValue")}
          value={<Span data-testid="batches-stat-value">{loading ? "—" : formatRupiah(res?.readyValueTotal ?? 0)}</Span>}
          note={t("batches.statReadyValueNote")}
          testId="batches-stat-ready-value"
        />
        <SummaryCard
          label={t("batches.statExpiring")}
          value={
            <Span color={expiring > 0n ? "warning.fg" : undefined} data-testid="batches-stat-expiring">
              {loading ? "—" : expiring.toString()}
            </Span>
          }
          note={t("batches.statExpiringNote")}
          testId="batches-stat-expiring-card"
        />
      </SummaryStrip>

      {/* THE SHARED FILTER STRIP (a-phone-filters-from-a-sheet, clear-filters-is-red-and-bold, every-filter-clears-from-
          its-own-x) — the search stays in the row on a phone; the expiry and the dates are in the sheet. */}
      <FilterBar testId="batches-filter" active={filtering > 0} count={filtering} onClear={clearFilters}>
        <FilterSearch
          value={search}
          onChange={(value) => refilter(() => setSearch(value))}
          placeholder={t("batches.searchPlaceholder")}
          testId="batches-search"
        />
        {/* WHOSE GOODS (owner: *"oke, kasih tim"*) — a warehouse holds several selling teams' stock. A search select: there
            is no ceiling on how many teams. Every option is a selling team, so the pick is its name alone
            (a-one-type-picker-shows-the-name-alone). Held in the URL; its ⚠ says it narrows nothing yet. */}
        <FilterField w="15rem" testId="batches-team-filter">
          <Flex align="center" gap="1">
            <Box flex="1" minW="0">
              <TeamSelect
                teamType={TeamType.SELLING}
                value={teamId > 0n ? teamId : undefined}
                placeholder={t("batches.teamAll")}
                showType={false}
                onChange={(id) => refilter(() => setTeamId(id))}
              />
            </Box>
            <NotImplemented list={BATCH_LIST_PENDING} id="teamFilter" />
          </Flex>
        </FilterField>
        <FilterField w="14rem" testId="batches-expiry-field">
          <ExpirySelect value={expiry} onChange={(v) => refilter(() => setExpiry(v))} />
        </FilterField>
        {/* Date range on the Arrived or Expiring date (#217/#225) — the date type and the window are one control, one
            panel (a-date-type-is-picked-inside-the-range-panel): find what came in, or expires, in a window. */}
        <FilterField w="auto">
          <DateRangePicker
            value={dateRange}
            testId="batches-date-range"
            fields={[
              { value: BatchDateField.ARRIVED, label: t("batches.dateArrived") },
              { value: BatchDateField.EXPIRING, label: t("batches.dateExpiring") },
            ]}
            field={dateField}
            onFieldChange={(v) => refilter(() => setDateField(v))}
            onChange={(r) => refilter(() => setDateRange(r))}
          />
        </FilterField>
      </FilterBar>

      {query.isError && (
        <Text color="error.fg" data-testid="batches-error">
          {rpcError(query.error)}
        </Text>
      )}

      {/* THE FIRST LOAD SHOWS THE LIST'S SHAPE, and the rows fade in over it (motion-is-small-quick-and-shared). */}
      {loading ? (
        <ListSkeleton testId="batches-loading" />
      ) : (
        <Box animationStyle="swap">
          <RefreshOverlay busy={query.isFetching && !query.isPending}>{list()}</RefreshOverlay>
        </Box>
      )}

      {/* THE PAGES GROW AS THEY ARE OPENED, and the pager is always on screen (every-list-pages-with-the-growing-pager,
          the-pager-is-always-on-screen). */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={query.isPlaceholderData ? undefined : page * pageSize < total}
        resetKey={[term, teamId, expiry, dateField, dateRangeCodec.encode(dateRange), pageSize].join("|")}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="batches-pager"
      />
    </Stack>
  );
}
