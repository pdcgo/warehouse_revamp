import { useTranslation } from "react-i18next";
import { Flex, Stack, Table, Text } from "@chakra-ui/react";

import { SortableHeader, type SortState } from "../../../components/chrome/SortableHeader";
import { type MetricDef, type TableGroup, isTimeGroup } from "../../../features/analytic/catalogue";
import type { MetricBody, ReportKey, ReportSort } from "../../../features/analytic/provider";
import { useIsMobile } from "../../../layouts/shell";
import { fieldLabel, formatFigure } from "../format";

/** A column's sort id — `key` for the period, `<metricId>|<field>` for a figure. */
function columnOf(sort: ReportSort | null): SortState<string> | null {
  if (!sort) return null;

  return sort.by === "key" ? { by: "key", dir: sort.dir } : { by: `${sort.metricId}|${sort.field}`, dir: sort.dir };
}

function sortOf(next: SortState<string>): ReportSort {
  if (next.by === "key") return { by: "key", dir: next.dir };

  const [metricId = "", field = ""] = next.by.split("|");

  return { by: "field", metricId, field, dir: next.dir };
}

// THE TABLE — one row per key step 1 sent, a column per figure of every selected metric, whichever service it comes
// from. Sorted from its headings, largest first, then flipped (a-table-sorts-from-its-headings), one column at a time
// (one-sort-field-per-table). Every row lights up under the pointer (a-table-row-lights-up); on a phone each row is a
// block, its figures as lines under its name (a-phone-reads-each-line-as-a-block).
export function ReportTable({
  groupBy,
  keys,
  defs,
  cells,
  sort,
  onSortChange,
  labelOf,
}: {
  groupBy: TableGroup;
  keys: ReportKey[];
  defs: MetricDef[];
  cells: Record<string, Record<ReportKey, MetricBody>>;
  sort: ReportSort | null;
  onSortChange: (next: ReportSort) => void;
  labelOf: (key: ReportKey) => string;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const columns = defs.flatMap((def) => def.fields.map((field) => ({ def, field, id: `${def.metricId}|${field.name}` })));
  // A field the service left unset stays undefined, and reads "—" (formatFigure).
  const value = (key: ReportKey, metricId: string, field: string) => cells[metricId]?.[key]?.[field];

  if (keys.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="analytic-table-empty">
        {t("analytic.empty.noRows")}
      </Text>
    );
  }

  if (isMobile) {
    return (
      <Stack gap="0" data-testid="analytic-table">
        {keys.map((key) => (
          <Stack key={key} gap="1" py="3" borderBottomWidth="1px" borderColor="border" data-testid={`analytic-row-${key}`}>
            <Text fontSize="sm" fontWeight="bold">
              {labelOf(key)}
            </Text>
            {columns.map(({ def, field, id }) => (
              <Flex key={id} justify="space-between" gap="3" fontSize="sm">
                <Text color="fg.muted">{fieldLabel(t, def, field.name)}</Text>
                <Text whiteSpace="nowrap" data-testid={`analytic-cell-${key}-${field.name}`}>
                  {formatFigure(field.kind, value(key, def.metricId, field.name))}
                </Text>
              </Flex>
            ))}
          </Stack>
        ))}
      </Stack>
    );
  }

  const current = columnOf(sort);
  const change = (next: SortState<string>) => onSortChange(sortOf(next));

  return (
    <Table.ScrollArea>
      <Table.Root size="sm" data-testid="analytic-table">
        <Table.Header>
          <Table.Row>
            {isTimeGroup(groupBy) ? (
              <SortableHeader
                column="key"
                label={t("analytic.period")}
                sort={current}
                onSortChange={change}
                testId="analytic-sort-key"
              />
            ) : (
              <Table.ColumnHeader>{t(`analytic.group.${groupBy}`)}</Table.ColumnHeader>
            )}
            {columns.map(({ def, field, id }) =>
              field.canSort ? (
                <SortableHeader
                  key={id}
                  column={id}
                  label={fieldLabel(t, def, field.name)}
                  sort={current}
                  onSortChange={change}
                  end
                  testId={`analytic-sort-${field.name}`}
                />
              ) : (
                <Table.ColumnHeader key={id} textAlign="end">
                  {fieldLabel(t, def, field.name)}
                </Table.ColumnHeader>
              ),
            )}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {keys.map((key) => (
            <Table.Row key={key} css={{ _hover: { "& > td": { bg: "bg.muted" } } }} data-testid={`analytic-row-${key}`}>
              <Table.Cell whiteSpace="nowrap">{labelOf(key)}</Table.Cell>
              {columns.map(({ def, field, id }) => (
                <Table.Cell key={id} textAlign="end" whiteSpace="nowrap" data-testid={`analytic-cell-${key}-${field.name}`}>
                  {formatFigure(field.kind, value(key, def.metricId, field.name))}
                </Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  );
}
