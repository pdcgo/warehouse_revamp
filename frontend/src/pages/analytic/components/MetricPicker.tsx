import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Checkbox, Flex, HStack, Icon, Input, Popover, Stack, Text } from "@chakra-ui/react";
import { ChevronRight, type LucideIcon, Package, Plus, Receipt, ShoppingCart, Wallet } from "lucide-react";

import {
  METRICS,
  METRIC_CATEGORIES,
  type MetricCategory,
  type MetricDef,
  type TableGroup,
  metricSlug,
} from "../../../features/analytic/catalogue";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ANALYTIC_PENDING } from "../pending";

export const CATEGORY_ICON: Record<MetricCategory, LucideIcon> = {
  order: ShoppingCart,
  settlement: Wallet,
  inventory: Package,
  expense: Receipt,
};

// ADD METRIC — picked the way a category is (owner: *"add metric is popup like selecting category"*): a popup with a
// search box over drill-down columns, CategorySelect's shape. The left column is the owner's categories
// (rpc_provide.md §Metric That Exist in Analytic); the chosen one, in rose, opens its metrics in the next column. Typing searches
// every category at once, each match named by its path.
//
// A metric is TICKED, not chosen-and-closed: the popup stays open, so several go on the table in one visit.
//
// A METRIC THAT CANNOT BE READ BY THE TABLE'S GROUP IS GREYED, WITH THE REASON (a-metric-that-cannot-group-is-greyed) —
// shown, so the person learns it exists, never tickable: the group is what the rows are, it never changes for a column.
//
// Not portalled, as CategorySelect is not.
export function MetricPicker({
  groupBy,
  selected,
  onToggle,
}: {
  groupBy: TableGroup;
  selected: string[];
  onToggle: (metricId: string, on: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<MetricCategory>(METRIC_CATEGORIES[0]!);
  const [query, setQuery] = useState("");

  const labelOf = (def: MetricDef) => t(`analytic.metric.${def.labelKey}`);
  const q = query.trim().toLowerCase();
  const matches = q
    ? METRICS.filter((def) => `${t(`analytic.category.${def.category}`)} ${labelOf(def)}`.toLowerCase().includes(q))
    : [];

  const row = (def: MetricDef, withPath: boolean) => {
    const readable = def.supportedGroupBy.includes(groupBy);
    const slug = metricSlug(def.metricId);

    return (
      <Checkbox.Root
        key={def.metricId}
        checked={selected.includes(def.metricId)}
        disabled={!readable}
        onCheckedChange={(e) => onToggle(def.metricId, e.checked === true)}
        alignItems="start"
        px="2"
        py="1.5"
        borderRadius="l2"
        _hover={readable ? { bg: "bg.muted" } : undefined}
        data-testid={`analytic-metric-${slug}`}
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control mt="0.5" />
        <Checkbox.Label flex="1">
          <Stack gap="0">
            <Text as="span" fontWeight="normal">
              {withPath ? `${t(`analytic.category.${def.category}`)} › ${labelOf(def)}` : labelOf(def)}
            </Text>
            {!readable && (
              <Text as="span" fontSize="xs" fontWeight="normal" color="fg.muted" data-testid={`analytic-metric-${slug}-reason`}>
                {t("analytic.cannotGroup", { group: t(`analytic.groupPlural.${groupBy}`) })}
              </Text>
            )}
          </Stack>
        </Checkbox.Label>
      </Checkbox.Root>
    );
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (e.open) setQuery("");
      }}
      positioning={{ placement: "bottom-start" }}
    >
      <Popover.Trigger asChild>
        <Button variant="outline" colorPalette="gray" data-testid="analytic-add-metric">
          <Icon as={Plus} boxSize="4" />
          {t("analytic.addMetric")}
          <NotImplemented list={ANALYTIC_PENDING} id="catalogue" />
        </Button>
      </Popover.Trigger>

      <Popover.Positioner>
        <Popover.Content width="auto" maxW="90vw" data-testid="analytic-metric-menu">
          <Popover.Body p="2">
            <Stack gap="2">
              <Input
                size="sm"
                placeholder={t("analytic.searchMetric")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="analytic-metric-search"
              />

              {q ? (
                <Box maxH="280px" overflowY="auto" minW="260px" data-testid="analytic-metric-search-results">
                  {matches.length === 0 ? (
                    <Text p="2" fontSize="sm" color="fg.muted">
                      {t("analytic.noMetricMatches")}
                    </Text>
                  ) : (
                    <Stack gap="0">{matches.map((def) => row(def, true))}</Stack>
                  )}
                </Box>
              ) : (
                <HStack align="stretch" gap="0">
                  {/* THE CATEGORIES — the chosen one in rose opens its metrics beside it. */}
                  <Box minW="180px" maxH="280px" overflowY="auto" borderRightWidth="1px" borderColor="border">
                    <Stack gap="0" p="1">
                      {METRIC_CATEGORIES.map((c) => (
                        <Button
                          key={c}
                          variant="ghost"
                          size="sm"
                          justifyContent="flex-start"
                          colorPalette={c === category ? "brand" : undefined}
                          aria-label={t("analytic.openCategory", { category: t(`analytic.category.${c}`) })}
                          aria-pressed={c === category}
                          onClick={() => setCategory(c)}
                          data-testid={`analytic-category-${c}`}
                        >
                          <Icon as={CATEGORY_ICON[c]} boxSize="4" />
                          <Text as="span" flex="1" textAlign="start" truncate>
                            {t(`analytic.category.${c}`)}
                          </Text>
                          <Icon as={ChevronRight} boxSize="4" />
                        </Button>
                      ))}
                    </Stack>
                  </Box>

                  {/* THE CHOSEN CATEGORY'S METRICS — ticked when on the table. */}
                  <Box minW="220px" maxH="280px" overflowY="auto" data-testid={`analytic-category-${category}-metrics`}>
                    <Stack gap="0" p="1">{METRICS.filter((def) => def.category === category).map((def) => row(def, false))}</Stack>
                  </Box>
                </HStack>
              )}

              <Flex justify="flex-end" borderTopWidth="1px" borderColor="border" pt="2">
                <Button size="xs" variant="ghost" onClick={() => setOpen(false)} data-testid="analytic-metric-done">
                  {t("common.done")}
                </Button>
              </Flex>
            </Stack>
          </Popover.Body>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
}
