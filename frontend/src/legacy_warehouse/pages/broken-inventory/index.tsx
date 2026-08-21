import { useState } from "react";
import { Stack, Text } from "@chakra-ui/react";
import { EggOff } from "lucide-react";
import { ChoiceTabs } from "../../../legacy/components/display/ChoiceTabs";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { Summary } from "../../../legacy/components/display/Summary";
import { ToneBadge } from "../../../legacy/components/badges/ToneBadge";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { ProblemRow } from "../../fixtures";

// ── PROBLEM ITEMS — THE REWRITE (routed as /problem-inventories-experimental) ───────────────────
//
// The same data as `problem-items`, regrouped. It runs beside it rather than replacing it, and the
// difference between the two is the interesting part:
//
//   problem-items (routed)   one row per PROBLEM      → "what do I need to decide?"
//   this screen              one row per SUBJECT       → "who or what is going wrong?"
//
// ⚠ THE REGROUPING IS THE WHOLE FEATURE. A flat problem list answers the operational question and
// completely hides the pattern: four separate damage reports against one supplier read as four
// unrelated incidents until they are on one row. The flat list is right for the person clearing the
// backlog; this one is right for the person who has to stop it recurring.
//
// Neither replaces the other — which is why both are in the menu, and why the choice of grouping is
// a tab rather than a decision the designer makes once.
export const description =
  "The same problems regrouped by subject — product, team, transaction — rather than listed flat. A flat list answers 'what must I decide'; this answers 'what is going wrong', and four incidents against one supplier only look like a pattern when they share a row.";

export type BrokenGrouping = "product" | "team" | "kind";

interface GroupRow {
  key: string;
  incidents: number;
  units: number;
  worstAgeDays: number;
  kinds: string[];
}

function ageInDays(at: number): number {
  return Math.floor((Date.now() / 1000 - at) / 86_400);
}

function group(rows: ProblemRow[], by: BrokenGrouping): GroupRow[] {
  const map = new Map<string, GroupRow>();

  for (const row of rows) {
    const key = by === "product" ? row.product : by === "team" ? row.team : row.kind;
    const existing = map.get(key) ?? { key, incidents: 0, units: 0, worstAgeDays: 0, kinds: [] };
    existing.incidents += 1;
    existing.units += row.units;
    existing.worstAgeDays = Math.max(existing.worstAgeDays, ageInDays(row.reportedAt));
    if (!existing.kinds.includes(row.kind)) existing.kinds.push(row.kind);
    map.set(key, existing);
  }

  // Most incidents first. A pattern is a repeat, so the row worth reading is the one that has
  // happened most — not the newest and not the biggest.
  return Array.from(map.values()).sort((a, b) => b.incidents - a.incidents);
}

export interface BrokenInventoryPageProps {
  rows: ProblemRow[];
  grouping?: BrokenGrouping;
  loading?: boolean;
}

export function BrokenInventoryPage({ rows, grouping: initial = "product", loading }: BrokenInventoryPageProps) {
  const [grouping, setGrouping] = useState<BrokenGrouping>(initial);

  const open = rows.filter((r) => !r.resolved);
  const grouped = group(open, grouping);

  // ⚠ THE REPEAT OFFENDERS ARE THE HEADLINE. One incident is bad luck; the same subject appearing
  // twice is a process problem, and it is the only thing on this screen that a flat list cannot say.
  const repeats = grouped.filter((g) => g.incidents > 1);

  const columns: Array<TableColumn<GroupRow>> = [
    { name: grouping === "product" ? "Product" : grouping === "team" ? "Team" : "Problem", key: "key", sticky: "left" },
    {
      name: "Incidents",
      align: "end",
      tooltip: "How many separate reports. More than one is a pattern, not bad luck.",
      render: (row) => (
        <Text fontSize="sm" fontWeight={row.incidents > 1 ? "semibold" : "normal"} color={row.incidents > 1 ? "fg.error" : undefined}>
          {row.incidents}
        </Text>
      ),
    },
    { name: "Units", key: "units", align: "end" },
    {
      name: "Kinds",
      render: (row) => (
        <Stack direction="row" gap="1" wrap="wrap">
          {row.kinds.map((k) => (
            <ToneBadge key={k} tone="plain">
              {k.replace("_", " ")}
            </ToneBadge>
          ))}
        </Stack>
      ),
    },
    {
      name: "Oldest open",
      align: "end",
      tooltip: "The longest anything in this group has been waiting for a decision.",
      render: (row) => <Text fontSize="sm">{row.worstAgeDays}d</Text>,
    },
  ];

  return (
    <Stack gap="section" p="page" data-testid="broken-inventory-page">
      <ScreenHeader icon={EggOff} title="Problem items — by subject" />

      <Summary
        columns={3}
        loading={loading}
        items={[
          { label: "Open incidents", value: open.length },
          { label: "Units affected", value: open.reduce((s, r) => s + r.units, 0), tone: "warning" },
          { label: "Repeat offenders", value: repeats.length, tone: repeats.length ? "error" : "plain" },
        ]}
      />

      {/* ⚠ THE GROUPING IS THE USER'S CHOICE, NOT THE DESIGNER'S. "Which product keeps breaking" and
          "which team keeps reporting" are different investigations, and picking one at design time
          means the other question needs a whole second screen — which is exactly how the original
          ended up with three near-identical tables. */}
      <Stack direction="row">
        <ChoiceTabs
          value={grouping}
          onChange={(v) => v && setGrouping(v)}
          items={[
            { value: "product" as const, name: "By product" },
            { value: "team" as const, name: "By team" },
            { value: "kind" as const, name: "By problem" },
          ]}
        />
      </Stack>

      <DataTable
        columns={columns}
        items={grouped}
        loading={loading}
        emptyTitle="Nothing outstanding"
        aria-label="Problems by subject"
        data-testid="broken-table"
      />
    </Stack>
  );
}
