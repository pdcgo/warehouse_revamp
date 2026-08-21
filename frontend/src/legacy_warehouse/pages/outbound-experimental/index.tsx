import { useCallback, useMemo, useState } from "react";
import { Box, Button, HStack, Icon, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Download, LogOut } from "lucide-react";
import { Alert } from "../../../legacy/components/display/Alert";
import { Card } from "../../../legacy/components/display/Card";
import { ScanStation, type ScanResult } from "../../components/scan/ScanStation";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import { MovementTable } from "../_movement/MovementTable";
import type { MovementRow } from "../../fixtures";

// ── OUTBOUND, THE SCAN-FIRST REWRITE ────────────────────────────────────────────────────────────
//
// The same job as `outbound`, answered the other way round.
//
//   outbound (original)   DESCRIBE the parcel with filters until the row appears
//   this screen           SCAN it — the parcel identifies itself
//
// ⚠ THE INVERSION IS THE WHOLE DESIGN. The original asks the operator questions about an object they
// are already holding. Scanning it skips all of them, and everything else on this screen follows
// from having made the scan the primary act:
//
//   · no cursor to place, so the operator's hands stay on the parcel and the scanner
//   · a sound per outcome, so the screen does not have to be looked at
//   · a running tally, because the question during a dispatch run is "how many left", not "which"
//   · a courier breakdown, because the parcels are handed over in courier piles
//
// ── AND IT DOES NOT REPLACE THE ORIGINAL ────────────────────────────────────────────────────────
//
// Both are in the menu, and that is right. Scanning answers "is THIS one ready" — it cannot answer
// "what is left to do", because you cannot scan the parcels you have not found yet. The original's
// mistake was only ever having the first question; replacing it outright would just invert the
// mistake.
export const description =
  "Outbound answered by scanning rather than filtering — the parcel identifies itself. Runs beside the original because scanning cannot answer 'what is left to do'.";

export interface OutboundScanPageProps {
  rows: MovementRow[];
  loading?: boolean;
}

export function OutboundScanPage({ rows, loading }: OutboundScanPageProps) {
  const [gate, setGate] = useState(true);
  const [scanned, setScanned] = useState<string[]>([]);

  const byAwb = useMemo(() => new Map(rows.map((r) => [r.awb.toUpperCase(), r])), [rows]);

  const resolve = useCallback(
    (code: string): Omit<ScanResult, "code"> => {
      const row = byAwb.get(code);
      if (!row) return { outcome: "not_found", detail: "Not in today's batch" };

      // ⚠ THE GATE IS THE POINT OF THE SCREEN, AND IT IS THE DIFFERENCE BETWEEN A GOOD DAY AND A
      // LOST PARCEL. An order that is in the batch but not finished being packed must NOT be handed
      // to the courier — and "not found" would be the wrong answer, because the operator would go
      // looking for a parcel that is right in front of them.
      if (gate && row.status !== "packing_completed") {
        return { outcome: "wrong_status", detail: `${row.ref} — still ${row.status.replace("_", " ")}` };
      }

      setScanned((prev) => (prev.includes(code) ? prev : [...prev, code]));
      return { outcome: "accepted", detail: `${row.ref} · ${row.product}` };
    },
    [byAwb, gate],
  );

  // The pile is handed over per courier, so the tally that matters during handover is per courier.
  const byCourier = useMemo(() => {
    const counts = new Map<string, { scanned: number; total: number }>();
    for (const row of rows) {
      const entry = counts.get(row.courier) ?? { scanned: 0, total: 0 };
      if (row.status === "packing_completed") entry.total += 1;
      if (scanned.includes(row.awb.toUpperCase())) entry.scanned += 1;
      counts.set(row.courier, entry);
    }
    return Array.from(counts.entries()).filter(([, v]) => v.total > 0);
  }, [rows, scanned]);

  const ready = rows.filter((r) => r.status === "packing_completed");
  const outstanding = ready.length - scanned.length;

  return (
    <Stack gap="section" p="page" data-testid="outbound-scan-page">
      <ScreenHeader
        icon={LogOut}
        title="Outbound — scan"
        actions={
          // ⚠ THE SESSION IS EXPORTABLE, and that matters more than it looks. A handover dispute
          // ("you gave me 98, the manifest says 103") is settled by what was actually scanned, and
          // the scan log is the only record of it. The original writes a CSV; keeping that is right.
          <Button size="xs" variant="outline" data-testid="export-session" disabled={scanned.length === 0}>
            <Icon as={Download} boxSize="4" />
            Export session
          </Button>
        }
      />

      <SimpleGrid columns={{ base: 1, xl: 2 }} gap="3" alignItems="start">
        <Card>
          <ScanStation
            title="Dispatch scan"
            resolve={resolve}
            gate="Packed only"
            gateEnabled={gate}
            onGateChange={setGate}
          />
        </Card>

        <Stack gap="3">
          {/* The number the run is actually about. Not "how many have I done" — how many are LEFT,
              because that is what tells the operator whether they can stop. */}
          <Card data-testid="outstanding">
            <Text fontSize="xs" color="fg.muted">
              Still to scan
            </Text>
            <Text fontSize="4xl" fontWeight="semibold" lineHeight="1.1">
              {outstanding}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              of {ready.length} packed and waiting
            </Text>
          </Card>

          {/* Parcels are handed over in courier piles, so the breakdown that matters at handover is
              per courier — not per team, per shop, or per anything else the data happens to have. */}
          <Card data-testid="courier-breakdown">
            <Text fontSize="sm" fontWeight="medium" mb="2">
              By courier
            </Text>
            <Stack gap="1">
              {byCourier.map(([courier, v]) => (
                <HStack key={courier} justify="space-between" data-testid="courier-row">
                  <Text fontSize="sm">{courier}</Text>
                  <Text fontSize="sm" color={v.scanned === v.total ? "fg.success" : "fg.muted"}>
                    {v.scanned} / {v.total}
                  </Text>
                </HStack>
              ))}
            </Stack>
          </Card>

          {!gate && (
            <Alert tone="warning" data-testid="gate-off-warning">
              The packed-only check is off. Anything scanned will be accepted, including orders the
              packer has not finished.
            </Alert>
          )}
        </Stack>
      </SimpleGrid>

      <Box>
        <Text fontSize="xs" color="fg.muted" mb="1">
          Packed and waiting
        </Text>
        <MovementTable direction="outbound" rows={ready} loading={loading} emptyTitle="Nothing packed yet" />
      </Box>
    </Stack>
  );
}
