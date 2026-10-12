import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex, Stack, Table, Text } from "@chakra-ui/react";

import { formatRupiah } from "../../lib/money";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { type SupplierFigures, brokenRate, lostRate } from "./figures";

// THE PIECES EVERY SUPPLIER FIGURE IS DRAWN WITH — shared by the Statistics tab (SupplierStatistics) and the Supplier
// Report page, so a supplier's numbers read the same in both places (the-figures-are-a-statistics-tab-and-a-supplier-report).
//
// Each figure is a COUNT and its VALUE (each-figure-is-read-at-the-accept) — one fact read twice, so they share a
// cell: units on top, rupiah under. Lost and broken sit BESIDE restocked, never inside it, so the broken rate is
// broken ÷ (restocked + lost + broken) — every unit that came off the supplier.

const units = (n: number) => n.toLocaleString("id-ID");
// A rate to one decimal, written the way the app writes every number — 4,6 rather than 4.6.
const pct = (rate: number) => rate.toLocaleString("id-ID", { maximumFractionDigits: 1 });

/** The window's headline: what was restocked, lost and broken, and the broken rate. */
export function FiguresSummary({ figures, testId = "figures-summary" }: { figures: SupplierFigures | undefined; testId?: string }) {
  const { t } = useTranslation();
  const rate = figures ? brokenRate(figures) : null;

  return (
    <Flex gap="card" wrap="wrap" borderWidth="1px" borderRadius="md" p="card" data-testid={testId}>
      <Tile
        label={t("supplierFigures.restocked")}
        hint={t("supplierFigures.restockedHint")}
        value={figures ? formatRupiah(figures.restockValue) : "—"}
        sub={figures ? t("supplierFigures.units", { count: figures.restockCount, n: units(figures.restockCount) }) : ""}
        testId={`${testId}-restocked`}
      />
      <Tile
        label={t("supplierFigures.lost")}
        hint={t("supplierFigures.lostHint")}
        value={figures ? formatRupiah(figures.lostValue) : "—"}
        sub={figures ? t("supplierFigures.units", { count: figures.lostCount, n: units(figures.lostCount) }) : ""}
        tone={figures && figures.lostCount > 0 ? "warning.fg" : undefined}
        testId={`${testId}-lost`}
      />
      <Tile
        label={t("supplierFigures.broken")}
        hint={t("supplierFigures.brokenHint")}
        value={figures ? formatRupiah(figures.brokenValue) : "—"}
        sub={figures ? t("supplierFigures.units", { count: figures.brokenCount, n: units(figures.brokenCount) }) : ""}
        tone={figures && figures.brokenCount > 0 ? "error.fg" : undefined}
        testId={`${testId}-broken`}
      />
      <Tile
        label={t("supplierFigures.brokenRate")}
        hint={t("supplierFigures.brokenRateHint")}
        value={rate === null ? "—" : t("supplierFigures.rate", { rate: pct(rate) })}
        sub=""
        testId={`${testId}-rate`}
      />
    </Flex>
  );
}

function Tile({
  label,
  value,
  sub,
  hint,
  tone,
  testId,
}: {
  label: string;
  value: string;
  sub: string;
  hint: string;
  tone?: string;
  testId: string;
}) {
  return (
    <Box minW="10rem" flex="1" data-testid={testId}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="lg" fontWeight="bold" color={tone} data-testid={`${testId}-value`}>
        {value}
      </Text>
      {sub && (
        <Text fontSize="sm" data-testid={`${testId}-units`}>
          {sub}
        </Text>
      )}
      <Text fontSize="xs" color="fg.muted">
        {hint}
      </Text>
    </Box>
  );
}

/** The four figure columns — restocked, lost, broken, broken rate — in the order the summary reads them. */
export function FigureHeaders() {
  const { t } = useTranslation();

  return (
    <>
      <Table.ColumnHeader textAlign="end">{t("supplierFigures.col.restocked")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("supplierFigures.col.lost")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("supplierFigures.col.broken")}</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">{t("supplierFigures.col.brokenRate")}</Table.ColumnHeader>
    </>
  );
}

/**
 * `rateMuted` greys the rate of a supplier with too few units to be rated against the others
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
  const { t } = useTranslation();
  const rate = brokenRate(figures);

  return (
    <>
      <CountCell count={figures.restockCount} value={figures.restockValue} />
      <CountCell count={figures.lostCount} value={figures.lostValue} tone="warning.fg" />
      <CountCell count={figures.brokenCount} value={figures.brokenValue} tone="error.fg" />
      <Table.Cell textAlign="end">
        <Text
          fontSize="sm"
          color={rate === null || rateMuted ? "fg.muted" : undefined}
          title={rateMuted ? rateMutedReason : undefined}
          data-muted={rateMuted ? "true" : undefined}
        >
          {rate === null ? "—" : t("supplierFigures.rate", { rate: pct(rate) })}
        </Text>
      </Table.Cell>
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

/**
 * One row as a BLOCK, for a phone (a-phone-reads-each-line-as-a-block): the title at full width with the broken rate
 * beside it, then the figures as lines.
 */
export function FigureBlock({
  title,
  sub,
  figures,
  onClick,
  rateMuted,
  testId,
}: {
  title: ReactNode;
  sub?: ReactNode;
  figures: SupplierFigures;
  onClick?: () => void;
  /** See FigureCells. */
  rateMuted?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const rate = brokenRate(figures);
  const lost = lostRate(figures);

  return (
    <Stack
      gap="1"
      borderWidth="1px"
      borderRadius="md"
      p="3"
      data-testid={testId}
      onClick={onClick}
      cursor={onClick ? "pointer" : undefined}
      _hover={onClick ? { bg: "bg.subtle" } : undefined}
    >
      <Flex justify="space-between" gap="2" align="baseline">
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
        <Text fontSize="sm" color={rate === null || rateMuted ? "fg.muted" : undefined} flexShrink="0">
          {rate === null ? "—" : t("supplierFigures.rateBroken", { rate: pct(rate) })}
        </Text>
      </Flex>
      <Text fontSize="sm">
        {t("supplierFigures.line.restocked", { n: units(figures.restockCount), value: formatRupiah(figures.restockValue) })}
      </Text>
      <Text fontSize="sm" color="fg.muted">
        {t("supplierFigures.line.lostBroken", {
          lost: units(figures.lostCount),
          lostRate: lost === null ? "—" : t("supplierFigures.rate", { rate: pct(lost) }),
          broken: units(figures.brokenCount),
        })}
      </Text>
    </Stack>
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
