import { useTranslation } from "react-i18next";

import type { MetricDef } from "../../../features/analytic/catalogue";
import type { MetricBody, ReportSort } from "../../../features/analytic/provider";
import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import { fieldLabel, formatFigure } from "../format";

// THE HEADLINE — one card per figure on the table, each the same metric read with group SUMMARY: everything the filters
// cover, never a sum of the page on screen (the-headline-is-the-metric-grouped-by-summary). The order list's card strip
// (a-list-summary-is-the-order-lists-card-strip); the sorted figure's card leads.
export function ReportHeadline({
  defs,
  summary,
  sort,
}: {
  defs: MetricDef[];
  summary: Record<string, MetricBody>;
  sort: ReportSort | null;
}) {
  const { t } = useTranslation();

  return (
    <SummaryStrip testId="analytic-headline">
      {defs.flatMap((def) =>
        def.fields.map((field) => (
          <SummaryCard
            key={`${def.metricId}|${field.name}`}
            label={fieldLabel(t, def, field.name)}
            value={formatFigure(field.kind, summary[def.metricId]?.[field.name] ?? 0)}
            line={t(`analytic.metric.${def.labelKey}`)}
            emphasis={sort?.by === "field" && sort.metricId === def.metricId && sort.field === field.name}
            testId={`analytic-headline-${field.name}`}
          />
        )),
      )}
    </SummaryStrip>
  );
}
