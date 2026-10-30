import { useState } from "react";
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
  SegmentGroup,
  Spacer,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowDownWideNarrow, ChartColumn, Download, SearchX } from "lucide-react";

import { rpcError } from "../../api/clients";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { DateRangePicker, LAST_MONTH } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { TeamItem } from "../../components/entity/TeamItem";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { windowOf } from "../../features/settlement/window";
import {
  RATE_MIN_UNITS,
  type SupplierRankBy,
  type SupplierRankRow,
  useSupplierHeadline,
  useSupplierRanking,
} from "../../features/suppliers/analytics";
import { FigureBlock, FigureCells, FigureHeaders, FiguresSummary, RestockTeamFilter } from "../../features/suppliers/FigureParts";
import { unitsReceived } from "../../features/suppliers/figures";
import { useTeam } from "../../features/team/TeamContext";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useIsMobile } from "../../layouts/shell";
import { useDebounced } from "../../lib/useDebounced";
import { dateRangeCodec, idCodec, oneOfCodec, textCodec, useUrlState } from "../../lib/urlState";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { SUPPLIER_REPORT_PENDING } from "./pending";
import { CompactActions } from "../../components/chrome/CompactActions";

// Penjualan beside Direstok carries THIS page's mark (`sales-sit-beside-restocked`).
const SALES_MARK = <NotImplemented list={SUPPLIER_REPORT_PENDING} id="sales" />;

const PAGE_SIZE = 20;

const RANK_BY_CODEC = oneOfCodec<SupplierRankBy>(["value", "brokenRate"]);

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up); Chakra's `_hover` honours `data-hover`.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// SupplierReportPage — which suppliers a team restocks from most, and which of them break or lose the most on the
// way (the-figures-are-a-statistics-tab-and-a-supplier-report). A page under Inventories, beside My Supplier and
// Discover Supplier.
//
// Two questions, top to bottom:
//
//   the headline   how much was restocked in the window, from every supplier, and how much of it arrived broken or
//                  short
//   the ranking    which supplier it came from — by restocked value, or by broken rate
//
// One supplier's figures over time, and by product, are its Statistics tab; a ranked row opens it.
//
// A search narrows both: it finds suppliers as the supplier list does (the-supplier-report-keeps-its-search).
//
// ⚠ EVERY TEAM'S RESTOCKS by default (every-selling-team-sees-every-teams-figures), narrowed to one selling team by a
// picker (the-team-filter-picks-any-selling-team) — your own for "what did WE buy where".
// So a supplier another team keeps — and that we have never bought from — can top the ranking, which is the point:
// it is how a team finds a better source than its own.
//
// Ranked by broken rate, a supplier needs the `rank_min_sample` on `broken_rate` — read off the proto — in the window to
// be rated against the others (rate-ranking-needs-50-units); the rest follow, in key order, their rate muted
// (a-rate-ranks-only-above-its-minimum-sample). A DELETED supplier is ranked with its figures kept
// (a-deleted-supplier-is-kept-for-its-figures), marked, and opens nothing — neither detail page shows a deleted one.
//
// ⚠ FOLDED, NOT LIVE: a figure can lag an accept by the broker's delivery (the-report-is-processed-like-settlement).
export function SupplierReportPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // THE FILTERS AND THE ORDER LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh, or Back from a supplier,
  // opens the same ranking. Its search finds suppliers as the supplier list does (the-supplier-report-keeps-its-search).
  const [range, setRange] = useUrlState<DateRange>("range", LAST_MONTH, dateRangeCodec);
  const [q, setQ] = useUrlState("q", "", textCodec);
  // Whose restocks — 0n is every team's.
  const [restockTeamId, setRestockTeamId] = useUrlState("team", 0n, idCodec);
  const [rankBy, setRankBy] = useUrlState<SupplierRankBy>("rank", "value", RANK_BY_CODEC);
  const [page, setPage] = useState(1);

  // Every control here is a new question — back to the ranking's first page.
  const pickRange = (next: DateRange) => {
    setRange(next);
    setPage(1);
  };

  const pickTeam = (next: bigint) => {
    setRestockTeamId(next);
    setPage(1);
  };

  const search = (next: string) => {
    setQ(next);
    setPage(1);
  };

  // Typed, then settled — a word is one request, not one per key.
  const term = useDebounced(q.trim());
  const filtering = q.trim() !== "" || restockTeamId !== 0n;

  const pickRankBy = (next: SupplierRankBy) => {
    setRankBy(next);
    setPage(1);
  };

  const { from, to } = windowOf(range);
  const valid = from !== "" && to !== "" && from <= to;

  const ranking = useSupplierRanking({
    teamId: current?.teamId,
    from,
    to,
    valid,
    restockTeamId,
    q: term,
    rankBy,
    page,
    pageSize: PAGE_SIZE,
  });
  // Every supplier the search finds, together — keyed without the page or the order, neither of which changes it.
  const headline = useSupplierHeadline({ teamId: current?.teamId, from, to, valid, restockTeamId, q: term });

  // The order the rows ON SCREEN are in. A new order keeps the old rows up while its page loads (HARD RULE 10), so the
  // fade is keyed on this rather than on the pick — it plays when the re-ordered rows land, not on the click.
  const [shownRankBy, setShownRankBy] = useState(rankBy);
  if (!ranking.isPending && !ranking.isPlaceholderData && shownRankBy !== rankBy) {
    setShownRankBy(rankBy);
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("supplierReport.title")}</Heading>
        <Text color="fg.muted" data-testid="supplier-report-no-team">
          {t("supplierReport.selectTeam")}
        </Text>
      </Stack>
    );
  }

  // Our own supplier opens where we manage it; another team's opens on Discover — the two details are separate pages
  // (manage-and-discover-are-two-pages), and both carry the Statistics tab.
  const open = (row: SupplierRankRow) => {
    if (row.supplier.deleted) return;

    navigate(
      row.supplier.teamId === current.teamId
        ? `/inventories/suppliers/${row.supplier.id}`
        : `/inventories/suppliers/discover/${row.supplier.id}`,
    );
  };

  const rows = ranking.data?.rows ?? [];
  const minUnits = RATE_MIN_UNITS;
  // Too few units to be rated against the others — the rate stays on screen, muted, with the reason on hover.
  const tooFew = (row: SupplierRankRow) => unitsReceived(row.figures) < minUnits;
  const nameOf = (row: SupplierRankRow) =>
    row.supplier.name || t("supplierReport.supplierNumber", { id: row.supplier.id.toString() });
  const busy = ranking.isFetching && !ranking.isPending;

  function list() {
    // A first load has nothing to keep on screen — the list's shape, never the empty sentence
    // (`motion-is-small-quick-and-shared`).
    if (ranking.isPending && valid) {
      return <ListSkeleton testId="supplier-report-loading" />;
    }

    if (rows.length === 0) {
      return (
        // AN EMPTY RANKING SAYS WHAT NEXT (an-empty-list-shows-a-hint) — another word, or another range.
        <EmptyHint
          icon={term !== "" ? SearchX : ChartColumn}
          title={
            term !== ""
              ? t("supplierReport.none")
              : restockTeamId !== 0n
                ? t("supplierReport.emptyTeam")
                : t("supplierReport.empty")
          }
          description={term !== "" ? t("emptyHint.noMatch") : t("emptyHint.otherPeriod")}
          testId="supplier-report-empty"
        />
      );
    }

    if (isMobile) {
      return (
        <Stack gap="2" data-testid="supplier-report-table">
          {rows.map((row) => (
            <FigureBlock
              salesMark={SALES_MARK}
              key={row.supplier.id.toString()}
              title={t("supplierReport.rankedName", { rank: row.rank, name: nameOf(row) })}
              sub={
                row.supplier.deleted
                  ? t("supplierReport.deleted")
                  : row.supplier.teamName || t("supplierFigures.teamNumber", { id: row.supplier.teamId.toString() })
              }
              figures={row.figures}
              rateMuted={tooFew(row)}
              onClick={row.supplier.deleted ? undefined : () => open(row)}
              testId={`supplier-report-row-${row.supplier.id}`}
            />
          ))}
        </Stack>
      );
    }

    return (
      <Box overflowX="auto">
        <Table.Root size="sm" data-testid="supplier-report-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader w="3rem">{t("supplierReport.col.rank")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("supplierReport.col.supplier")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("supplierReport.col.keptBy")}</Table.ColumnHeader>
              <FigureHeaders salesMark={SALES_MARK} />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row
                key={row.supplier.id.toString()}
                data-testid={`supplier-report-row-${row.supplier.id}`}
                cursor={row.supplier.deleted ? undefined : "pointer"}
                // Every row lights up, every cell (a-table-row-lights-up) — a deleted one too: it is read across even
                // though it opens nothing.
                css={LIGHTS_UP}
                onClick={() => open(row)}
              >
                <Table.Cell>
                  <Text fontSize="sm" color="fg.muted" data-testid="supplier-report-rank">
                    {row.rank}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <HStack gap="2">
                    <Text fontSize="sm" fontWeight="bold" data-testid="supplier-report-name">
                      {nameOf(row)}
                    </Text>
                    {row.supplier.deleted && (
                      <Badge colorPalette="gray" data-testid="supplier-report-deleted">
                        {t("supplierReport.deleted")}
                      </Badge>
                    )}
                  </HStack>
                </Table.Cell>
                <Table.Cell>
                  <Box maxW="15rem">
                    <TeamItem
                      team={{ teamId: row.supplier.teamId, teamName: row.supplier.teamName, teamType: TeamType.SELLING }}
                    />
                  </Box>
                </Table.Cell>
                <FigureCells
                  figures={row.figures}
                  rateMuted={tooFew(row)}
                  rateMutedReason={t("supplierReport.rateTooFew", { n: minUnits })}
                />
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    );
  }

  return (
    // The page arrives — a fade and a short rise (`motion-is-small-quick-and-shared`).
    <Stack gap="section" animationStyle="enter" data-testid="supplier-report-page">
      {/* The title and its subtitle as one block, the page's action on the title's row — as on the account report. */}
      {isMobile ? (
        // A PHONE'S HEADER IS ONE ROW (owner: *"export di report mobile kurang bagus"*, `the-report-export-folds-on-a-phone`,
        // the-phone-header-is-one-row): the title and the export's icon — wrapped under the subtitle it stood alone, a
        // button belonging to nothing; it was a ⋯ of one line until a-phone-header-action-is-an-icon. The subtitle under
        // the row.
        <Stack gap="1">
          <Flex align="center" gap="2">
            <Heading size="md" flex="1" minW="0" truncate>
              {t("supplierReport.title")}
            </Heading>
            {/* One action, so its icon — not a ⋯ holding one line (a-phone-header-action-is-an-icon). */}
            <CompactActions
              menuLabel={t("supplierReport.actions")}
              menuTestId="supplier-report-menu"
              actions={[
                {
                  id: "export",
                  label: t("supplierReport.export"),
                  icon: Download,
                  mark: <NotImplemented list={SUPPLIER_REPORT_PENDING} id="export" />,
                  testId: "supplier-report-export",
                },
              ]}
            />
          </Flex>
          <Text fontSize="sm" color="fg.muted">
            {t("supplierReport.subtitle")}
          </Text>
        </Stack>
      ) : (
        <Flex gap="3" align="start" justify="space-between" wrap="wrap">
          <Stack gap="1" flex="1 1 16rem">
            <Heading size="md">{t("supplierReport.title")}</Heading>
            <Text fontSize="sm" color="fg.muted">
              {t("supplierReport.subtitle")}
            </Text>
          </Stack>
          {/* EXPORT, NOT BUILT (owner: *"ada export di sini, kasih unimplemented jadinya"*, `the-report-export-is-marked`)
              — a grey outline with its icon (an-action-button-carries-its-icon); it takes nothing out of the screen yet,
              and the ⚠ number points at why. */}
          <Button variant="outline" colorPalette="gray" data-testid="supplier-report-export">
            <Icon as={Download} boxSize="4" />
            {t("supplierReport.export")}
            <NotImplemented list={SUPPLIER_REPORT_PENDING} id="export" />
          </Button>
        </Flex>
      )}

      <NotImplementedSummary list={SUPPLIER_REPORT_PENDING} />

      <FilterBar
        testId="supplier-report-filter"
        active={filtering}
        count={(q.trim() !== "" ? 1 : 0) + (restockTeamId !== 0n ? 1 : 0)}
        onClear={() => {
          search("");
          pickTeam(0n);
        }}
      >
        <FilterSearch
          value={q}
          onChange={search}
          placeholder={t("supplierReport.search")}
          testId="supplier-report-search"
        />
        <FilterField w="15rem" testId="supplier-report-team">
          <RestockTeamFilter value={restockTeamId} onChange={pickTeam} />
        </FilterField>
        <FilterField w="auto">
          <DateRangePicker value={range} onChange={pickRange} testId="supplier-report-range" />
        </FilterField>
      </FilterBar>

      {!valid && (
        <Text fontSize="sm" color="error.fg" data-testid="supplier-report-range-invalid">
          {t("supplierFigures.rangeInvalid")}
        </Text>
      )}

      {(ranking.isError || headline.isError) && (
        <Text fontSize="sm" color="error.fg" data-testid="supplier-report-error">
          {rpcError(ranking.error ?? headline.error)}
        </Text>
      )}

      <RefreshOverlay busy={headline.isFetching && !headline.isPending}>
        <FiguresSummary figures={headline.data} salesMark={SALES_MARK} testId="supplier-report-summary" />
      </RefreshOverlay>

      <Stack gap="field">
        <Flex align="center" gap="card" wrap="wrap">
          <Heading size="sm">{t("supplierReport.ranking")}</Heading>
          <Spacer />
          {/* THE ORDER, AS A SEGMENTED CHOICE (a-segmented-choice-is-in-the-main-tone) — a field's height, the chosen
              segment pale rose. It was an attached pair of solid/outline buttons.
              IT READS AS AN ORDER (owner: *"sortnya kasih panah biar kelihatan itu sort?"* — then *"a aja"*,
              `the-report-order-shows-its-arrow`): a visible "Urutkan" before it (*"urutkan saja"*), and each segment's icon the
              sort-down arrow — the contract ranks one way only, largest first, so there is no other arrow to show. */}
          <HStack gap="2">
            <Text fontSize="sm" color="fg.muted" whiteSpace="nowrap">
              {t("supplierReport.rankBy")}
            </Text>
            <SegmentGroup.Root
              value={rankBy}
              // Ark emits null when the chosen segment is clicked again — an order has no "off".
              onValueChange={(e) => pickRankBy((e.value as SupplierRankBy | null) ?? rankBy)}
              aria-label={t("supplierReport.rankBy")}
              data-testid="supplier-report-rank-by"
            >
              <SegmentGroup.Indicator />
              <SegmentGroup.Item value="value" data-testid="supplier-report-rank-by-value">
                <Icon as={ArrowDownWideNarrow} boxSize="3.5" />
                <SegmentGroup.ItemText>{t("supplierReport.byValue")}</SegmentGroup.ItemText>
                <SegmentGroup.ItemHiddenInput />
              </SegmentGroup.Item>
              <SegmentGroup.Item value="brokenRate" data-testid="supplier-report-rank-by-rate">
                <Icon as={ArrowDownWideNarrow} boxSize="3.5" />
                <SegmentGroup.ItemText>{t("supplierReport.byBrokenRate")}</SegmentGroup.ItemText>
                <SegmentGroup.ItemHiddenInput />
              </SegmentGroup.Item>
            </SegmentGroup.Root>
          </HStack>
        </Flex>

        {/* The rows fade in when they first land, and again when they land in a new order — never on a refresh
            (`motion-is-small-quick-and-shared`). */}
        <RefreshOverlay busy={busy}>
          <Box key={ranking.isPending && valid ? "loading" : shownRankBy} animationStyle="swap">
            {list()}
          </Box>
        </RefreshOverlay>

        {/* The rule the order follows, said where it applies (rate-ranking-needs-50-units). */}
        {rankBy === "brokenRate" && minUnits > 0 && rows.length > 0 && (
          <Text fontSize="xs" color="fg.muted" data-testid="supplier-report-rate-note">
            {t("supplierReport.rateMinNote", { n: minUnits })}
          </Text>
        )}

        {/* No total: a metric page says only whether another follows (a-metric-page-has-no-total) — the growing pager
            (every-list-pages-with-the-growing-pager). */}
        <GrowingPager
          page={page}
          onPageChange={setPage}
          hasNext={ranking.isPlaceholderData ? undefined : ranking.data?.hasNext}
          resetKey={[term, from, to, restockTeamId, rankBy].join("|")}
          pageSize={PAGE_SIZE}
          testId="supplier-report-pager"
        />
      </Stack>
    </Stack>
  );
}
