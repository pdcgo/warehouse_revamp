import { SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { EggOff } from "lucide-react";
import { BarChart } from "../../../legacy/components/charts/BarChart";
import { Card } from "../../../legacy/components/display/Card";
import { Summary } from "../../../legacy/components/display/Summary";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { ProblemKind, ProblemRow } from "../../fixtures";

// ── PROBLEM ITEMS — THE RETIRED GENERATION ──────────────────────────────────────────────────────
//
// ⚠ THIS SCREEN IS NOT ROUTED. It exists in the original's source and nothing points at it — the
// menu goes to the flat list, and the EXP entry goes to the by-subject rewrite. It is ported anyway,
// because the three of them together say something none of them says alone.
//
//   this screen         charts        "how bad is it, in aggregate?"
//   problem-items       a flat list   "what do I need to decide?"
//   broken-inventory    grouped       "what keeps going wrong?"
//
// The progression is the finding: it starts as a REPORT, and each generation moves closer to being
// something you can ACT on. This one has a headline count, a breakdown by kind and a trend — and no
// way whatsoever to do anything about any of it. There is no row, no decision, no note. You can see
// that damage is up and you cannot see which items.
//
// That is why it was replaced rather than extended, and it is a useful thing to have in front of you
// before designing a screen for this system: a dashboard about a problem is not a tool for fixing
// it, and the two are easy to confuse while sketching.
export const description =
  "The RETIRED first generation — charts and totals, and no way to act on any of it. Kept unrouted beside its two successors because the progression is the point: each generation moved from reporting the problem to being able to do something about it.";

const KIND_LABEL: Record<ProblemKind, string> = {
  damaged: "Damaged",
  lost: "Lost",
  wrong_item: "Wrong item",
  expired: "Expired",
};

export interface RetiredProblemPageProps {
  rows: ProblemRow[];
  // Units reported per week, oldest first. The trend the screen was built around.
  weekly?: number[];
  loading?: boolean;
}

export function RetiredProblemPage({ rows, weekly = [4, 9, 3, 12, 6, 14], loading }: RetiredProblemPageProps) {
  const open = rows.filter((r) => !r.resolved);
  const units = open.reduce((s, r) => s + r.units, 0);

  const byKind = (Object.keys(KIND_LABEL) as ProblemKind[]).map((kind) => ({
    kind,
    units: open.filter((r) => r.kind === kind).reduce((s, r) => s + r.units, 0),
  }));

  return (
    <Stack gap="section" p="page" data-testid="retired-problem-page">
      <ScreenHeader icon={EggOff} title="Problem items — overview" />

      <Text fontSize="sm" color="fg.muted" data-testid="retired-note">
        Retired. Kept for reference beside the two screens that replaced it.
      </Text>

      <Summary
        columns={3}
        loading={loading}
        items={[
          { label: "Open incidents", value: open.length },
          { label: "Units affected", value: units, tone: "warning" },
          { label: "Teams affected", value: new Set(open.map((r) => r.team)).size },
        ]}
      />

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="3">
        <Card>
          <Text fontSize="sm" fontWeight="medium" mb="2">
            Units by problem
          </Text>
          {/* Grouped, not stacked, and one series — the question is "how do these compare", and every
              bar has to start from the same baseline for that to be readable. */}
          <BarChart
            labels={byKind.map((k) => KIND_LABEL[k.kind])}
            series={[{ name: "Units", values: byKind.map((k) => k.units) }]}
            loading={loading}
            height={200}
            emptyText="Nothing reported"
          />
        </Card>

        <Card>
          <Text fontSize="sm" fontWeight="medium" mb="2">
            Units reported per week
          </Text>
          <BarChart
            labels={weekly.map((_, i) => `W${i + 1}`)}
            series={[{ name: "Units", values: weekly }]}
            loading={loading}
            height={200}
            emptyText="No history"
          />
        </Card>
      </SimpleGrid>

      {/* ⚠ THE DEAD END, STATED. Everything above is a number. There is no row to click, no item to
          name, and no decision to record — so a reader who concludes "damage is up" has nowhere to
          go from here. Both successors start from a row for exactly this reason. */}
      <Card data-testid="dead-end">
        <Text fontSize="sm" color="fg.muted">
          Nothing on this screen can be acted on — there is no item, no owner and no decision, only
          totals. That is what the two screens which replaced it added.
        </Text>
      </Card>
    </Stack>
  );
}
