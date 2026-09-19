import { useState } from "react";
import { Button, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { EggOff, Wrench } from "lucide-react";
import { ChoiceTabs } from "../../../legacy/components/display/ChoiceTabs";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { DateCell } from "../../../legacy/components/cells/DateCell";
import { ToneBadge } from "../../../legacy/components/badges/ToneBadge";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { ProblemKind, ProblemRow } from "../../fixtures";

// ── PROBLEM ITEMS — THE ROUTED GENERATION ───────────────────────────────────────────────────────
//
// Stock that is here but wrong: damaged, lost, the wrong item, expired. This is the screen the
// menu points at; there are two other generations of it in this folder (see the readme), and the
// three together are the clearest thing in the port about how a screen evolves.
//
// ⚠ WHAT MAKES A PROBLEM LIST DIFFERENT FROM EVERY OTHER LIST: nothing removes a row.
//
// An order leaves the outbound list when it ships. A problem leaves this list only when a person
// DECIDES something — write it off, charge the supplier, find it. Nobody is measured on deciding, so
// nothing gets decided, and the list grows forever.
//
// That is why age is a first-class column here and not a detail. A six-week-old open problem is a
// different object from a six-hour-old one: the six-hour one is being handled, and the six-week one
// has been forgotten. They look identical without the date.
export const description =
  "Stock that is here but wrong. Age is a first-class column: nothing removes a row from a problem list except a person deciding, so old open rows are the thing the screen exists to surface.";

const KIND_LABEL: Record<ProblemKind, string> = {
  damaged: "Damaged",
  lost: "Lost",
  wrong_item: "Wrong item",
  expired: "Expired",
};

const KIND_TONE: Record<ProblemKind, "error" | "warning" | "info" | "plain"> = {
  damaged: "warning",
  lost: "error",
  wrong_item: "info",
  expired: "plain",
};

// Anything open past this is not being worked on. Named rather than inlined, because the whole
// screen's point is that this threshold exists.
const STALE_DAYS = 14;

function ageInDays(at: number): number {
  return Math.floor((Date.now() / 1000 - at) / 86_400);
}

export interface ProblemItemsPageProps {
  rows: ProblemRow[];
  loading?: boolean;
}

export function ProblemItemsPage({ rows, loading }: ProblemItemsPageProps) {
  const [kind, setKind] = useState<ProblemKind | undefined>();

  const open = rows.filter((r) => !r.resolved);
  const filtered = (kind ? open.filter((r) => r.kind === kind) : open);
  const stale = open.filter((r) => ageInDays(r.reportedAt) > STALE_DAYS);

  const columns: Array<TableColumn<ProblemRow>> = [
    {
      name: "Product",
      sticky: "left",
      render: (row) => (
        <Stack gap="0" maxW="64">
          <Text fontSize="sm" lineClamp={1}>
            {row.product}
          </Text>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {row.sku}
          </Text>
        </Stack>
      ),
    },
    { name: "Team", key: "team" },
    { name: "Problem", render: (row) => <ToneBadge tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</ToneBadge> },
    { name: "Units", key: "units", align: "end" },
    {
      // ⚠ THE NOTE IS A COLUMN, NOT A HOVER. It is the only field that says WHY, and it is what the
      // person deciding needs. Hiding it behind a tooltip means the decision is made without it.
      name: "What happened",
      render: (row) => (
        <Text fontSize="sm" color="fg.muted" maxW="72" lineClamp={2}>
          {row.note || "No note"}
        </Text>
      ),
    },
    { name: "Reported by", key: "reportedBy" },
    {
      name: "Age",
      align: "end",
      tooltip: `Open longer than ${STALE_DAYS} days means nobody is working on it.`,
      render: (row) => {
        const days = ageInDays(row.reportedAt);
        const isStale = days > STALE_DAYS;
        return (
          <Stack gap="0" alignItems="end" data-testid="problem-age" data-stale={isStale ? "true" : "false"}>
            <Text fontSize="sm" fontWeight={isStale ? "semibold" : "normal"} color={isStale ? "fg.error" : undefined}>
              {days}d
            </Text>
            <DateCell value={row.reportedAt} grain="date" />
          </Stack>
        );
      },
    },
    {
      name: "",
      sticky: "right",
      render: () => (
        <Button size="xs" variant="outline" data-testid="decide">
          <Icon as={Wrench} boxSize="3" />
          Decide
        </Button>
      ),
    },
  ];

  return (
    <Stack gap="section" p="page" data-testid="problem-items-page">
      <ScreenHeader icon={EggOff} title="Problem items" />

      {/* The count that matters is not how many problems there are — it is how many nobody has
          touched. A total goes up and down with normal breakage; this only goes up when the team
          stops deciding. */}
      {stale.length > 0 && (
        <Text fontSize="sm" color="fg.error" data-testid="stale-warning">
          {stale.length} open longer than {STALE_DAYS} days — nobody is working on {stale.length === 1 ? "it" : "them"}.
        </Text>
      )}

      <HStack>
        <ChoiceTabs
          value={kind}
          onChange={setKind}
          clearable
          items={(Object.keys(KIND_LABEL) as ProblemKind[]).map((k) => ({
            value: k,
            name: KIND_LABEL[k],
            badge: open.filter((r) => r.kind === k).length,
          }))}
        />
      </HStack>

      <DataTable
        columns={columns}
        items={filtered}
        loading={loading}
        emptyTitle={kind ? "None of this kind" : "Nothing outstanding"}
        aria-label="Problem items"
        data-testid="problem-table"
      />
    </Stack>
  );
}
