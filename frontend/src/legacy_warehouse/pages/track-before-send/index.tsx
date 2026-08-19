import { useCallback, useMemo, useState } from "react";
import { SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { ClipboardList } from "lucide-react";
import { Alert } from "../../../legacy/components/display/Alert";
import { Card } from "../../../legacy/components/display/Card";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { ToneBadge } from "../../../legacy/components/badges/ToneBadge";
import { ScanStation, type ScanResult } from "../../components/scan/ScanStation";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { TrackedParcel } from "../../fixtures";

// ── TRACK BEFORE SEND ───────────────────────────────────────────────────────────────────────────
//
// The last check before the courier drives away: scan the pile, and see what is on the manifest but
// not in the pile.
//
// ⚠ THIS IS THE ONE SCREEN IN THE FLOOR APP THAT IS BUILT AROUND AN ABSENCE, and that makes it the
// most interesting one here.
//
// Every other screen answers a question about something that exists — this order, this SKU, this
// problem. This one answers "what is MISSING", which cannot be scanned, cannot be filtered for, and
// has no row until you compare two sets. The design consequence is that the SCAN IS NOT THE OUTPUT:
// scanning is just how the screen learns what is present, and the answer is the residue.
//
// That is also why it is worth the trouble. A missing parcel found here is found while the courier
// is still standing there. The same parcel found tomorrow is a customer complaint, a claim, and
// nobody able to say whether it left the building.
//
// ⚠ IT MOUNTS OUTSIDE THE SHELL. There is no sidebar — the screen is used at the loading door on a
// handheld, and a menu is a way to lose your place mid-count.
export const description =
  "The last check before the courier leaves: scan the pile, and the screen shows what is on the manifest but NOT in it. The only screen built around an absence — the scan is how it learns what is present, and the answer is the residue.";

const STATUS_LABEL: Record<TrackedParcel["status"], string> = {
  not_scanned: "Not scanned",
  scanned: "In the pile",
  handed_over: "Handed over",
  missing: "Missing",
};

const STATUS_TONE = {
  not_scanned: "plain",
  scanned: "info",
  handed_over: "success",
  missing: "error",
} as const;

export interface TrackBeforeSendPageProps {
  parcels: TrackedParcel[];
  loading?: boolean;
}

export function TrackBeforeSendPage({ parcels, loading }: TrackBeforeSendPageProps) {
  const [found, setFound] = useState<string[]>([]);

  const byAwb = useMemo(() => new Map(parcels.map((p) => [p.awb.toUpperCase(), p])), [parcels]);

  const resolve = useCallback(
    (code: string): Omit<ScanResult, "code"> => {
      const parcel = byAwb.get(code);
      // ⚠ A PARCEL IN THE PILE THAT IS NOT ON THE MANIFEST IS ALSO A PROBLEM — it belongs to another
      // run, another courier, or another day, and putting it on this van loses it just as surely as
      // leaving one behind.
      if (!parcel) return { outcome: "not_found", detail: "Not on this manifest — do not load it" };

      setFound((prev) => (prev.includes(code) ? prev : [...prev, code]));
      return { outcome: "accepted", detail: `${parcel.courier} · ${parcel.team}` };
    },
    [byAwb],
  );

  // The residue. Everything on the manifest that the scan has not accounted for.
  const outstanding = parcels.filter((p) => !found.includes(p.awb.toUpperCase()) && p.status !== "handed_over");
  const missing = parcels.filter((p) => p.status === "missing");

  const columns: Array<TableColumn<TrackedParcel>> = [
    { name: "Waybill", sticky: "left", render: (p) => <Text fontFamily="mono" fontSize="sm">{p.awb}</Text> },
    { name: "Courier", key: "courier" },
    { name: "Team", key: "team" },
    {
      name: "State",
      render: (p) => {
        const scanned = found.includes(p.awb.toUpperCase());
        const status = scanned ? "scanned" : p.status;
        return (
          <ToneBadge tone={STATUS_TONE[status]} data-testid="parcel-state" data-state={status}>
            {STATUS_LABEL[status]}
          </ToneBadge>
        );
      },
    },
  ];

  return (
    <Stack gap="section" p="page" data-testid="track-before-send-page">
      <ScreenHeader icon={ClipboardList} title="Track before send" />

      <SimpleGrid columns={{ base: 1, xl: 2 }} gap="3" alignItems="start">
        <Card>
          <ScanStation title="Scan the pile" resolve={resolve} />
        </Card>

        <Stack gap="3">
          {/* ⚠ THE HEADLINE IS THE ABSENCE, NOT THE PROGRESS. "12 scanned" is a number about the
              operator; "3 unaccounted for" is a number about the parcels, and only the second one
              decides whether the courier can leave. */}
          <Card data-testid="unaccounted">
            <Text fontSize="xs" color="fg.muted">
              Unaccounted for
            </Text>
            <Text
              fontSize="4xl"
              fontWeight="semibold"
              lineHeight="1.1"
              color={outstanding.length ? "fg.error" : "fg.success"}
            >
              {outstanding.length}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              on the manifest, not yet in the pile
            </Text>
          </Card>

          {missing.length > 0 && (
            <Alert tone="error" title="Packed but not found" data-testid="missing-alert">
              {missing.length} {missing.length === 1 ? "parcel is" : "parcels are"} packed and on the
              manifest but nobody can find {missing.length === 1 ? "it" : "them"}. Find{" "}
              {missing.length === 1 ? "it" : "them"} before the courier leaves — tomorrow this is a
              claim with nobody able to say whether it left the building.
            </Alert>
          )}

          {outstanding.length === 0 && (
            <Alert tone="success" data-testid="all-clear">
              Everything on the manifest is in the pile. The courier can go.
            </Alert>
          )}
        </Stack>
      </SimpleGrid>

      <DataTable
        columns={columns}
        items={parcels}
        loading={loading}
        emptyTitle="Nothing on this manifest"
        aria-label="Manifest"
        data-testid="manifest-table"
      />
    </Stack>
  );
}
