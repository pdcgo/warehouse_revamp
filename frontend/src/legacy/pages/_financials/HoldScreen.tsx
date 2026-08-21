import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Download, Unlock } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { Alert } from "../../components/display/Alert";
import { DataTable, type TableColumn, type TableSort } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { Pagination } from "../../../components/chrome/Pagination";
import { formatRupiahCompact } from "../../../lib/money";

// ── HELD FUNDS ──────────────────────────────────────────────────────────────────────────────────
//
// Money a marketplace has taken but not yet released — the gap between an order being paid for and
// the cash actually arriving. There are two views of it, by SHOP and by TEAM, and they are the same
// screen with the subject changed.
//
// ⚠ THE AGE OF A HOLD IS THE POINT, NOT ITS SIZE. Marketplaces release funds on a schedule, so a
// large hold from yesterday is normal and a small one from six weeks ago is a problem — something is
// stuck. A screen sorted by amount would put the normal case at the top and bury the broken one.
//
// So it sorts by age, and anything past the expected release window is marked. "Overdue release" is
// the only actionable state on this screen; everything else is just waiting.
export const description =
  "Money a marketplace has taken but not released. Sorted by AGE, not amount — a large hold from yesterday is normal, a small one from six weeks ago is stuck, and sorting by size buries the broken case.";

// How long a hold may sit before it stops being normal. Marketplaces here release on roughly a
// two-week cycle, so past three weeks something has gone wrong rather than slowly.
const OVERDUE_DAYS = 21;

export interface HoldRow {
  id: bigint;
  subject: string;
  marketplace: string;
  amount: bigint;
  heldSince: bigint;
  orderCount: number;
}

export interface HoldScreenProps {
  // What the rows are ABOUT — "Shop" or "Team".
  subjectLabel: string;
  title: string;
  rows: HoldRow[];
  loading?: boolean;
  isError?: boolean;
}

function ageInDays(heldSince: bigint, now = Date.now()): number {
  return Math.floor((now - Number(heldSince) * 1000) / 86_400_000);
}

export function HoldScreen({
  subjectLabel,
  title,
  rows,
  loading,
  isError,
}: HoldScreenProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TableSort>();
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? rows.filter((r) => r.subject.toLowerCase().includes(q)) : rows;

    if (sort?.key) {
      const direction = sort.desc ? -1 : 1;
      return [...base].sort((a, b) => {
        const av = a[sort.key as keyof HoldRow] ?? 0;
        const bv = b[sort.key as keyof HoldRow] ?? 0;
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * direction;
      });
    }

    // Default: OLDEST HOLD FIRST — the stuck one, not the biggest one.
    return [...base].sort((a, b) => Number(a.heldSince - b.heldSince));
  }, [rows, search, sort]);

  const overdue = rows.filter((r) => ageInDays(r.heldSince) > OVERDUE_DAYS);
  const total = rows.reduce((s, r) => s + r.amount, 0n);

  const columns: Array<TableColumn<HoldRow>> = [
    { name: subjectLabel, key: "subject", sortKey: "subject", sticky: "left" },
    { name: "Marketplace", key: "marketplace" },
    { name: "Orders", key: "orderCount", align: "end", sortKey: "orderCount" },
    {
      name: "Held",
      align: "end",
      sortKey: "amount",
      render: (r) => <StatisticCell value={r.amount} kind="price" compact />,
    },
    {
      name: "Since",
      sortKey: "heldSince",
      render: (r) => <DateCell value={r.heldSince} grain="relative" />,
    },
    {
      name: "Status",
      // The only actionable state on the screen.
      render: (r) =>
        ageInDays(r.heldSince) > OVERDUE_DAYS ? (
          <ToneBadge tone="error" data-testid="hold-overdue">
            Overdue release
          </ToneBadge>
        ) : (
          <ToneBadge tone="plain">Waiting</ToneBadge>
        ),
    },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: () => <ActionCell items={[{ title: "Chase release", icon: Unlock, tone: "warning" }]} />,
    },
  ];

  return (
    <Stack gap="section" data-testid="hold-screen" data-subject={subjectLabel}>
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Stack gap="0.5">
          <Heading size="md">{title}</Heading>
          <Text fontSize="sm" color="fg.muted">
            Money taken by a marketplace but not yet released.
          </Text>
        </Stack>
        <Button tone="plain" variant="outline" icon={Download}>
          Export
        </Button>
      </HStack>

      {overdue.length > 0 && (
        <Alert tone="error" title={`${overdue.length} hold${overdue.length === 1 ? "" : "s"} past the usual release window`} data-testid="hold-warning">
          Anything older than {OVERDUE_DAYS} days is stuck rather than slow. Chase these first.
        </Alert>
      )}

      <Summary
        items={[
          { label: "Total held", value: formatRupiahCompact(total), tone: "warning" },
          { label: "Holds", value: rows.length },
          { label: "Overdue", value: overdue.length, tone: overdue.length > 0 ? "error" : "plain" },
        ]}
        loading={loading}
        columns={3}
      />

      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder={subjectLabel}
        maxW="64"
      />

      <DataTable
        columns={columns}
        items={filtered.slice((page - 1) * 20, page * 20)}
        loading={loading}
        isError={isError}
        sort={sort}
        onSort={setSort}
        emptyTitle="Nothing held"
        emptyContent="Every marketplace has released what it owes."
        errorTitle="Could not load held funds"
        aria-label={title}
      />

      <Pagination count={filtered.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}
