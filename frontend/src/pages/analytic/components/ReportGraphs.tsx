import { SimpleGrid, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { LineGraph } from "../../../components/charts/LineGraph";
import { type FieldKind, type MetricDef, type TableGroup, isTimeGroup } from "../../../features/analytic/catalogue";
import type { MetricBody, ReportKey } from "../../../features/analytic/provider";
import { formatRupiahCompact } from "../../../lib/money";
import { fieldLabel, formatFigure } from "../format";

/** A figure on the side axis: money short (Rp 1,5jt) so the magnitude reads first, a count as the table writes it. */
function formatTick(kind: FieldKind, value: number): string {
  return kind === "money" ? formatRupiahCompact(BigInt(Math.round(value))) : value.toLocaleString("id-ID");
}

// THE GRAPH — the table drawn as line charts (the-graph-draws-the-table): its group along the bottom, the value up the
// side, ONE GRAPH PER KIND OF NUMBER among its columns, each column a line in the legend. Two metrics' money fields share
// a graph, which is where they get compared. It draws the cells the table already holds: no call and no state of its
// own, so it can never disagree with the table under it.
//
// `kind` is this screen's mirror of the proto's FieldStatType (a-field-declares-its-stat-type): count is QTY, money is
// CURRENCY. When the provider reads the descriptor, a RATIO graph comes with it.
//
// A TIME GROUP IS DRAWN OLDEST FIRST (a-time-graph-runs-oldest-first),
// even when the table lists newest first or by a figure, because a line over days that runs right to left reads as the
// opposite trend. An id group keeps the table's order, its ranking.
export function ReportGraphs({
  groupBy,
  keys,
  defs,
  cells,
  labelOf,
}: {
  groupBy: TableGroup;
  keys: ReportKey[];
  defs: MetricDef[];
  cells: Record<string, Record<ReportKey, MetricBody>>;
  labelOf: (key: ReportKey) => string;
}) {
  const { t } = useTranslation();

  const points = isTimeGroup(groupBy) ? [...keys].sort() : keys;
  // The kinds in column order, so the graphs read in the order the table's columns do.
  const kinds = [...new Set(defs.flatMap((def) => def.fields.map((f) => f.kind)))];
  if (kinds.length === 0) return null;

  // Nothing in this period reads the same on both tabs (the-table-and-the-graph-are-tabs), never an empty frame.
  if (points.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="analytic-graph-empty">
        {t("analytic.empty.noRows")}
      </Text>
    );
  }

  const labels = points.map(labelOf);

  return (
    <SimpleGrid columns={{ base: 1, lg: kinds.length > 1 ? 2 : 1 }} gap="card" data-testid="analytic-graphs">
      {kinds.map((kind) => (
        <LineGraph
          key={kind}
          title={t(`analytic.graph.${kind}`)}
          labels={labels}
          lines={defs.flatMap((def) =>
            def.fields
              .filter((f) => f.kind === kind)
              .map((f) => ({
                label: fieldLabel(t, def, f.name),
                values: points.map((key) => cells[def.metricId]?.[key]?.[f.name] ?? 0),
              })),
          )}
          formatValue={(v) => formatFigure(kind, v)}
          formatTick={(v) => formatTick(kind, v)}
          wholeNumbers={kind === "count"}
          testId={`analytic-graph-${kind}`}
        />
      ))}
    </SimpleGrid>
  );
}
