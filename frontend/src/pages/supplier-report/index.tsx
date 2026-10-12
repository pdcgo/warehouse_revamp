import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Button, Flex, HStack, Heading, Icon, SegmentGroup, Spacer, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowDownWideNarrow, Download } from "lucide-react";

import { rpcError } from "../../api/clients";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { DateRangePicker } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { TeamItem } from "../../components/entity/TeamItem";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { windowOf } from "../../features/settlement/window";
import {
  type SupplierRankBy,
  type SupplierRankRow,
  useSupplierRanking,
} from "../../features/suppliers/analytics";
import { FigureBlock, FigureCells, FigureHeaders, FiguresSummary, RestockTeamFilter } from "../../features/suppliers/FigureParts";
import { unitsReceived } from "../../features/suppliers/figures";
import { useTeam } from "../../features/team/TeamContext";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useIsMobile } from "../../layouts/shell";
import { useDebounced } from "../../lib/useDebounced";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { SUPPLIER_REPORT_PENDING } from "./pending";

const PAGE_SIZE = 20;

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up); Chakra's `_hover` honours `data-hover`.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// SupplierReportPage — which suppliers a team restocks from most, and which of them break or lose the most on the
// way (the-figures-are-a-statistics-tab-and-a-supplier-report). A page under Inventories, beside My Supplier and
// Discover Supplier.
//
// Two questions, top to bottom:
//
//   the headline   how much was restocked in the window, from every supplier the search finds, and how much of it
//                  arrived broken or short
//   the ranking    which supplier it came from — by restocked value, or by broken rate
//
// One supplier's figures over time, and by product, are its Statistics tab; a ranked row opens it.
//
// The search finds suppliers as Discover does — name, address, contact, store names (the-supplier-report-searches-like-discover).
//
// ⚠ EVERY TEAM'S RESTOCKS by default (every-selling-team-sees-every-teams-figures), narrowed to one selling team by a
// picker (the-team-filter-picks-any-selling-team) — your own for "what did WE buy where".
// So a supplier another team keeps — and that we have never bought from — can top the ranking, which is the point:
// it is how a team finds a better source than its own.
//
// Ranked by broken rate, a supplier needs the server's `rate_min_units` in the window to be rated against the others
// (rate-ranking-needs-50-units); the rest follow, their rate muted. A DELETED supplier is ranked with its figures kept
// (a-deleted-supplier-is-kept-for-its-figures), marked, and opens nothing — neither detail page shows a deleted one.
//
// ⚠ FOLDED, NOT LIVE: a figure can lag an accept by the broker's delivery (the-report-is-processed-like-settlement).
export function SupplierReportPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const [range, setRange] = useState<DateRange>({ kind: "relative", days: 30 });
  const [q, setQ] = useState("");
  // Whose restocks — 0n is every team's.
  const [restockTeamId, setRestockTeamId] = useState(0n);
  const [rankBy, setRankBy] = useState<SupplierRankBy>("value");
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
    rankBy,
    q: term,
    page,
    pageSize: PAGE_SIZE,
  });

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
  const minUnits = ranking.data?.rateMinUnits ?? 0;
  // Too few units to be rated against the others — the rate stays on screen, muted, with the reason on hover.
  const tooFew = (row: SupplierRankRow) => unitsReceived(row.figures) < minUnits;
  const nameOf = (row: SupplierRankRow) =>
    row.supplier.name || t("supplierReport.supplierNumber", { id: row.supplier.id.toString() });
  const busy = ranking.isFetching && !ranking.isPending;

  function list() {
    // A first load has nothing to keep on screen — its own spinner, never the empty sentence.
    if (ranking.isPending && valid) {
      return <Spinner colorPalette="brand" />;
    }

    if (rows.length === 0) {
      return (
        <Text fontSize="sm" color="fg.muted" data-testid="supplier-report-empty">
          {term !== ""
            ? t("supplierReport.none")
            : restockTeamId !== 0n
              ? t("supplierReport.emptyTeam")
              : t("supplierReport.empty")}
        </Text>
      );
    }

    if (isMobile) {
      return (
        <Stack gap="2" data-testid="supplier-report-table">
          {rows.map((row) => (
            <FigureBlock
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
              <FigureHeaders />
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
    <Stack gap="section" data-testid="supplier-report-page">
      {/* The title and its subtitle as one block, the page's action on the title's row — as on the account report. */}
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

      {ranking.isError && (
        <Text fontSize="sm" color="error.fg" data-testid="supplier-report-error">
          {rpcError(ranking.error)}
        </Text>
      )}

      <RefreshOverlay busy={busy}>
        <FiguresSummary figures={ranking.data?.total} testId="supplier-report-summary" />
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

        <RefreshOverlay busy={busy}>{list()}</RefreshOverlay>

        {/* The rule the order follows, said where it applies (rate-ranking-needs-50-units). */}
        {rankBy === "brokenRate" && minUnits > 0 && rows.length > 0 && (
          <Text fontSize="xs" color="fg.muted" data-testid="supplier-report-rate-note">
            {t("supplierReport.rateMinNote", { n: minUnits })}
          </Text>
        )}

        {/* every-list-pages-with-the-growing-pager — the pages opened so far, one click back to any of them. */}
        <GrowingPager
          page={page}
          onPageChange={setPage}
          hasNext={ranking.isPlaceholderData ? undefined : page * PAGE_SIZE < (ranking.data?.totalItems ?? 0)}
          resetKey={[term, restockTeamId, from, to, rankBy].join("|")}
          pageSize={PAGE_SIZE}
          testId="supplier-report-pager"
        />
      </Stack>
    </Stack>
  );
}
