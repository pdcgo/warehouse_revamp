import { useMemo, useState } from "react";
import { Box, Button, HStack, Icon, Input, NativeSelect, Stack, Text, Wrap } from "@chakra-ui/react";
import { LogOut, X } from "lucide-react";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import { MovementTable } from "../_movement/MovementTable";
import { statusOptions, type MovementStatus } from "../../status";
import type { MovementRow } from "../../fixtures";

// ── OUTBOUND, THE ORIGINAL ──────────────────────────────────────────────────────────────────────
//
// A filter bar over a table. This is the screen the rewrite replaces, and it is worth keeping beside
// it because the two are a clean statement of the same job answered two ways:
//
//   this screen        you QUERY for the order, then act on the row     → keyboard and eyes
//   outbound-experimental  you SCAN the parcel and it finds itself      → scanner and ears
//
// ⚠ THE DIAGNOSIS THE REWRITE IS BASED ON. This screen is 912 lines in the original, and almost all
// of it is filtering. That is not waste — it is the screen answering "which of today's four hundred
// orders is this parcel in my hand?" by making the operator describe it. Every filter is a question
// the operator has to answer about an object they are already holding.
//
// The rewrite's insight is that the parcel already knows. Scanning it skips the entire filter bar.
//
// That does NOT make this screen obsolete, which is why both are still in the menu: filtering is how
// you answer "what is left to do", and scanning cannot answer that. They are different questions,
// and the original's mistake was only ever having the first one.
export const description =
  "Outbound as a filter bar over a table — you query for the order, then act on the row. Kept beside the scan-first rewrite: filtering answers 'what is left to do', which scanning cannot.";

export interface OutboundPageProps {
  rows: MovementRow[];
  loading?: boolean;
}

export function OutboundPage({ rows, loading }: OutboundPageProps) {
  const [status, setStatus] = useState<MovementStatus | "">("");
  const [team, setTeam] = useState("");
  const [awb, setAwb] = useState("");

  const teams = useMemo(() => Array.from(new Set(rows.map((r) => r.team))), [rows]);

  const filtered = rows.filter(
    (r) =>
      (!status || r.status === status) &&
      (!team || r.team === team) &&
      (!awb || r.awb.toUpperCase().includes(awb.toUpperCase())),
  );

  const active = [
    status && { key: "status", label: `Status: ${status}`, clear: () => setStatus("") },
    team && { key: "team", label: `Team: ${team}`, clear: () => setTeam("") },
    awb && { key: "awb", label: `Waybill: ${awb}`, clear: () => setAwb("") },
  ].filter(Boolean) as Array<{ key: string; label: string; clear(): void }>;

  return (
    <Stack gap="section" p="page" data-testid="outbound-page">
      <ScreenHeader icon={LogOut} title="Outbound" />

      <HStack gap="2" wrap="wrap" data-testid="outbound-filters">
        <NativeSelect.Root size="sm" w="52" data-testid="filter-status">
          <NativeSelect.Field
            value={status}
            onChange={(e) => setStatus(e.currentTarget.value as MovementStatus | "")}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            {statusOptions("outbound").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <NativeSelect.Root size="sm" w="48" data-testid="filter-team">
          <NativeSelect.Field value={team} onChange={(e) => setTeam(e.currentTarget.value)} aria-label="Team">
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <Input
          size="sm"
          w="52"
          placeholder="Waybill"
          value={awb}
          onChange={(e) => setAwb(e.currentTarget.value)}
          aria-label="Waybill"
          data-testid="filter-awb"
        />
      </HStack>

      {/* ⚠ ACTIVE FILTERS ARE LISTED AND INDIVIDUALLY REMOVABLE.
          With three controls this looks like decoration. It is not: on a screen where an empty
          result is the normal outcome of a mis-set filter, "no orders found" and "no orders exist"
          are indistinguishable unless the screen shows what it is currently excluding. The original
          has this, and it is the best thing on the screen. */}
      {active.length > 0 && (
        <Wrap gap="2" data-testid="active-filters">
          {active.map((f) => (
            <Button key={f.key} size="xs" variant="subtle" onClick={f.clear} data-testid={`active-filter-${f.key}`}>
              {f.label}
              <Icon as={X} boxSize="3" />
            </Button>
          ))}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => active.forEach((f) => f.clear())}
            data-testid="clear-filters"
          >
            Clear all
          </Button>
        </Wrap>
      )}

      <Box>
        <Text fontSize="xs" color="fg.muted" mb="1" data-testid="result-count">
          {filtered.length} of {rows.length} orders
        </Text>
        <MovementTable
          direction="outbound"
          rows={filtered}
          loading={loading}
          emptyTitle={active.length > 0 ? "No orders match these filters" : "Nothing to send"}
        />
      </Box>
    </Stack>
  );
}
