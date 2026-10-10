import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex, Span, Stack, Table, Text } from "@chakra-ui/react";

import { formatRupiah } from "../../lib/money";
import { SummaryCard, SummaryStrip } from "../orders/SummaryCard";
import { useIsMobile } from "../../layouts/shell";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { type SupplierFigures, brokenRate, lostRate, unitsReceived } from "./figures";

// THE PIECES EVERY SUPPLIER FIGURE IS DRAWN WITH — shared by the Statistics tab (SupplierStatistics) and the Supplier
// Report page, so a supplier's numbers read the same in both places (the-figures-are-a-statistics-tab-and-a-supplier-report).
//
// Each figure is a COUNT and its VALUE (each-figure-is-read-at-the-accept) — one fact read twice, so they share a
// cell: units on top, rupiah under. Lost and broken sit BESIDE restocked, never inside it, so the broken rate is
// broken ÷ (restocked + lost + broken) — every unit that came off the supplier.

const units = (n: number) => n.toLocaleString("id-ID");
// A rate to one decimal, written the way the app writes every number — 4,6 rather than 4.6.
const pct = (rate: number) => rate.toLocaleString("id-ID", { maximumFractionDigits: 1 });

/**
 * The window's headline: what was restocked, lost and broken — the order list's strip of cards
 * (a-list-summary-is-the-order-lists-card-strip, a-summary-card-is-grey-with-a-thin-border): a label, ONE figure, the
 * units on the quiet line, how the figure is made under it. It was a box of its own, the one stat box in the app that
 * was not the shared card (owner, on the Statistik tab: *"kotaknya yang diubah"*).
 *
 * THE RATES SIT IN THEIR OWN CARDS (owner: *"untuk tingkat kerusakan dan hilang kasih saja di card hilang dan rusak
 * dengan persentasenya sesuai warna nomornya"*): lost and broken each carry their share of every unit received beside
 * their units, bold, in the figure's tone — no Tingkat rusak card of its own, and the lost rate is on a desktop too now.
 *
 * THE TOTAL LEADS (owner: *"iya, kasih total"*): every unit received — restocked, lost and broken — and its value, the
 * strip's one lead card, so a percentage has its whole on screen: "1 unit · 0,7% dari total".
 *
 *   ┌ Total ───────┐ ┌ Direstok ────┐ ┌ Hilang di… ──────────┐ ┌ Rusak di… ───────────┐
 *   │ Rp 4.645.000 │ │ Rp 4.400.000 │ │ Rp 50.000            │ │ Rp 195.000           │
 *   │ 137 unit     │ │ 130 unit     │ │ 1 unit · 0,7% dari…  │ │ 6 unit · 4,4% dari…  │
 */
export function FiguresSummary({ figures, testId = "figures-summary" }: { figures: SupplierFigures | undefined; testId?: string }) {
  const { t } = useTranslation();

  // The units, on the card's quiet line — tagged, so a story can read them apart from the value.
  const unitLine = (count: number, id: string) =>
    figures ? <Span data-testid={`${testId}-${id}-units`}>{t("supplierFigures.units", { count, n: units(count) })}</Span> : undefined;

  // A lost or broken figure in its status tone once there is any — written as a ROLE, never a hue (CLAUDE.md).
  const toneOf = (count: number, tone: string) => (count > 0 ? tone : undefined);
  const toned = (value: bigint, count: number, tone: string) =>
    figures ? <Span color={toneOf(count, tone)}>{formatRupiah(value)}</Span> : "—";

  // …and its share of every unit received BESIDE THE UNITS, bold, in the same tone (owner: *"persentase kasih di sebelah
  // unit, bold"*), after a dot, saying what it is a share OF (*"disebelah unit ada . persetase ada keterangan dari
  // total"*) — "6 unit · 4,4% dari total". Nothing received is no rate, not 0%.
  const unitsAndRate = (count: number, rate: number | null, tone: string, id: string) =>
    figures ? (
      <>
        {unitLine(count, id)}
        {rate !== null && (
          <>
            {" · "}
            <Span color={toneOf(count, tone)} fontWeight="bold" data-testid={`${testId}-${id}-rate`}>
              {t("supplierFigures.rate", { rate: pct(rate) })}
            </Span>{" "}
            {t("supplierFigures.ofTotal")}
          </>
        )}
      </>
    ) : undefined;

  const received = figures ? unitsReceived(figures) : 0;

  // HOW A FIGURE IS MADE is a desktop line: on a phone two cards share a row and the note was always cut to "unit
  // yang…" (owner: *"iya"*, `a-phone-card-shows-no-note`) — the label, the figure and its units say enough there.
  const isMobile = useIsMobile();
  const note = (key: string) => (isMobile ? undefined : t(key));

  return (
    <SummaryStrip testId={testId}>
      <SummaryCard
        label={t("supplierFigures.total")}
        value={figures ? formatRupiah(figures.restockValue + figures.lostValue + figures.brokenValue) : "—"}
        line={unitLine(received, "total")}
        note={note("supplierFigures.totalHint")}
        emphasis
        testId={`${testId}-total`}
      />
      <SummaryCard
        label={t("supplierFigures.restocked")}
        value={figures ? formatRupiah(figures.restockValue) : "—"}
        line={unitLine(figures?.restockCount ?? 0, "restocked")}
        note={note("supplierFigures.restockedHint")}
        testId={`${testId}-restocked`}
      />
      <SummaryCard
        label={t("supplierFigures.lost")}
        value={toned(figures?.lostValue ?? 0n, figures?.lostCount ?? 0, "warning.fg")}
        line={unitsAndRate(figures?.lostCount ?? 0, figures ? lostRate(figures) : null, "warning.fg", "lost")}
        note={note("supplierFigures.lostHint")}
        testId={`${testId}-lost`}
      />
      <SummaryCard
        label={t("supplierFigures.broken")}
        value={toned(figures?.brokenValue ?? 0n, figures?.brokenCount ?? 0, "error.fg")}
        line={unitsAndRate(figures?.brokenCount ?? 0, figures ? brokenRate(figures) : null, "error.fg", "broken")}
        note={note("supplierFigures.brokenHint")}
        testId={`${testId}-broken`}
      />
    </SummaryStrip>
  );
}

/** The four figure columns — restocked, lost, broken, broken rate — in the order the summary reads them. */
export function FigureHeaders() {
  const { t } = useTranslation();

  return (
    <>
      <Table.ColumnHeader textAlign="end">{t("supplierFigures.col.restocked")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("supplierFigures.col.lost")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("supplierFigures.col.lostRate")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("supplierFigures.col.broken")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("supplierFigures.col.brokenRate")}</Table.ColumnHeader>
    </>
  );
}

/**
 * Restocked, lost and broken — each units over value — and lost and broken each followed by ITS OWN RATE COLUMN (owner:
 * *"persentase jadi column beda aja kalau gitu"*): the share of the row's units received, in the figure's tone once there
 * is any, as the cards read it (the-loss-rates-sit-in-their-cards). The lost rate was a phone's alone until now.
 *
 * `rateMuted` greys the broken rate of a supplier with too few units to be rated against the others
 * (rate-ranking-needs-50-units) — shown, never hidden, with the reason on hover.
 */
export function FigureCells({
  figures,
  rateMuted,
  rateMutedReason,
}: {
  figures: SupplierFigures;
  rateMuted?: boolean;
  rateMutedReason?: string;
}) {
  return (
    <>
      <CountCell count={figures.restockCount} value={figures.restockValue} />
      <CountCell count={figures.lostCount} value={figures.lostValue} tone="warning.fg" />
      <RateCell rate={lostRate(figures)} count={figures.lostCount} tone="warning.fg" testId="figure-lost-rate" />
      <CountCell count={figures.brokenCount} value={figures.brokenValue} tone="error.fg" />
      <RateCell
        rate={brokenRate(figures)}
        count={figures.brokenCount}
        tone="error.fg"
        muted={rateMuted}
        mutedReason={rateMutedReason}
        testId="figure-broken-rate"
      />
    </>
  );
}

// Units over their value. A zero is ONE muted "0" — shown, not hidden, because "nothing broken" is the answer somebody
// came for, but without an "Rp 0" under it: a quiet day would otherwise print six zeroes.
function CountCell({ count, value, tone }: { count: number; value: bigint; tone?: string }) {
  if (count === 0) {
    return (
      <Table.Cell textAlign="end">
        <Text fontSize="sm" color="fg.muted">
          0
        </Text>
      </Table.Cell>
    );
  }

  return (
    <Table.Cell textAlign="end">
      <Text fontSize="sm" color={tone}>
        {units(count)}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {formatRupiah(value)}
      </Text>
    </Table.Cell>
  );
}

// A share of the row's units received. In the figure's tone once there is any; a muted 0% when none of them went that
// way; a dash when nothing arrived at all — no rate, which is not a rate of 0.
function RateCell({
  rate,
  count,
  tone,
  muted,
  mutedReason,
  testId,
}: {
  rate: number | null;
  count: number;
  tone: string;
  muted?: boolean;
  mutedReason?: string;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <Table.Cell textAlign="end">
      <Text
        fontSize="sm"
        color={rate === null || count === 0 || muted ? "fg.muted" : tone}
        title={muted ? mutedReason : undefined}
        data-muted={muted ? "true" : undefined}
        data-testid={testId}
      >
        {rate === null ? "—" : t("supplierFigures.rate", { rate: pct(rate) })}
      </Text>
    </Table.Cell>
  );
}

/**
 * One row as a BLOCK, for a phone (a-phone-reads-each-line-as-a-block): the title at full width, then the figures as
 * lines — restocked, then lost and broken each with its rate beside it, in the figure's tone, as the desktop's columns
 * read them (owner, on the phone: *"diperbaiki"*, `a-phone-figures-block-reads-the-columns`). The broken rate is no
 * longer repeated beside the title.
 *
 *   2026-10-08
 *   Direstok 40 · Rp 2.000.000
 *   Hilang 1 · 2,3%    Rusak 2 · 4,7%
 */
export function FigureBlock({
  title,
  sub,
  header,
  figures,
  onClick,
  rateMuted,
  testId,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Drawn in place of the title and its sub-line — a product block's picture, name and SKU (ProductListItem). */
  header?: ReactNode;
  figures: SupplierFigures;
  onClick?: () => void;
  /** See FigureCells. */
  rateMuted?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <Stack
      gap="1"
      borderWidth="1px"
      borderRadius="md"
      p="3"
      data-testid={testId}
      onClick={onClick}
      cursor={onClick ? "pointer" : undefined}
      _hover={onClick ? { bg: "bg.muted" } : undefined}
      _active={onClick ? { bg: "bg.muted" } : undefined}
    >
      {header ?? (
        <Box minW="0">
          <Text fontWeight="bold" truncate>
            {title}
          </Text>
          {sub && (
            <Text fontSize="sm" color="fg.muted" truncate>
              {sub}
            </Text>
          )}
        </Box>
      )}
      <Text fontSize="sm">
        {t("supplierFigures.line.restocked", { n: units(figures.restockCount), value: formatRupiah(figures.restockValue) })}
      </Text>
      <Flex fontSize="sm" columnGap="4" rowGap="0.5" wrap="wrap">
        <BlockLoss
          label={t("supplierFigures.line.lost", { n: units(figures.lostCount) })}
          count={figures.lostCount}
          rate={lostRate(figures)}
          tone="warning.fg"
          testId={`${testId}-lost`}
        />
        <BlockLoss
          label={t("supplierFigures.line.broken", { n: units(figures.brokenCount) })}
          count={figures.brokenCount}
          rate={brokenRate(figures)}
          tone="error.fg"
          muted={rateMuted}
          testId={`${testId}-broken`}
        />
      </Flex>
    </Stack>
  );
}

// "Hilang 1 · 2,3%" — the count in the figure's tone once there is any, its rate beside it in the same tone (muted when
// none went that way, or when a supplier has too few units to be rated); no rate when nothing arrived.
function BlockLoss({
  label,
  count,
  rate,
  tone,
  muted,
  testId,
}: {
  label: string;
  count: number;
  rate: number | null;
  tone: string;
  muted?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const color = count > 0 ? tone : "fg.muted";

  return (
    <Text as="span" data-testid={testId}>
      <Span color={color}>{label}</Span>
      {rate !== null && (
        <>
          {" · "}
          <Span color={muted || count === 0 ? "fg.muted" : tone} data-testid={`${testId}-rate`}>
            {t("supplierFigures.rate", { rate: pct(rate) })}
          </Span>
        </>
      )}
    </Text>
  );
}

/**
 * Whose restocks are counted — the daily rows' `team_id` (every-selling-team-sees-every-teams-figures,
 * the-team-filter-picks-any-selling-team). A selling-team picker, empty = every team: only a selling team restocks from
 * a supplier. Picking your own team is "ours". Shared by the Statistics tab and the Supplier Report, so the one filter
 * looks the same in both.
 */
export function RestockTeamFilter({ value, onChange }: { value: bigint; onChange: (teamId: bigint) => void }) {
  const { t } = useTranslation();

  return (
    <TeamSelect
      value={value}
      teamType={TeamType.SELLING}
      placeholder={t("supplierFigures.everyTeam")}
      onChange={onChange}
    />
  );
}
