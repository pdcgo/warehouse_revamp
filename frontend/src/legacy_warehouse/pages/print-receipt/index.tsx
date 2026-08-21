import { useState } from "react";
import { Button, Checkbox, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { Printer } from "lucide-react";
import { Alert } from "../../../legacy/components/display/Alert";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { ToneBadge } from "../../../legacy/components/badges/ToneBadge";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { ReceiptJob } from "../../fixtures";

// ── PRINT SHIPPING LABELS ───────────────────────────────────────────────────────────────────────
//
// The courier's label for each parcel. Like the barcode screens it mounts outside the shell and is
// its own print output.
//
// ⚠ THE THING THIS SCREEN HAS TO GET RIGHT IS THE REPRINT, AND IT IS EASY TO GET WRONG IN BOTH
// DIRECTIONS.
//
//   block reprints    a jammed printer, a smudged label, a parcel repacked → the operator is stuck,
//                     and works around it by printing the whole batch again
//   allow silently    two identical labels exist, both scannable, and one parcel gets delivered
//                     twice or the second one goes on the wrong box
//
// So: reprinting is allowed, and it is MARKED. The row says it has been printed before, and
// reprinting is a deliberate second click rather than the same click as the first. The operator
// keeps the escape hatch; the state stays visible.
//
// ⚠ AND ALREADY-PRINTED ROWS ARE UNSELECTED BY DEFAULT. "Select all" on a batch where half are done
// is the single most likely way to produce a pile of duplicates, so the default selection is what is
// outstanding, not everything.
export const description =
  "Courier labels, outside the shell. Reprinting is allowed and MARKED — blocking it strands the operator on a jammed printer, allowing it silently puts two scannable labels on two boxes. Printed rows start unselected.";

export interface PrintReceiptPageProps {
  jobs: ReceiptJob[];
  loading?: boolean;
}

export function PrintReceiptPage({ jobs, loading }: PrintReceiptPageProps) {
  // ⚠ THE DEFAULT SELECTION IS WHAT IS OUTSTANDING. See above.
  const [selected, setSelected] = useState<string[]>(() => jobs.filter((j) => !j.printed).map((j) => j.awb));

  const toggle = (awb: string) =>
    setSelected((prev) => (prev.includes(awb) ? prev.filter((a) => a !== awb) : [...prev, awb]));

  const reprints = selected.filter((awb) => jobs.find((j) => j.awb === awb)?.printed).length;

  const columns: Array<TableColumn<ReceiptJob>> = [
    {
      name: "",
      width: "10",
      render: (job) => (
        <Checkbox.Root
          size="sm"
          checked={selected.includes(job.awb)}
          onCheckedChange={() => toggle(job.awb)}
          data-testid="job-checkbox"
          data-awb={job.awb}
        >
          <Checkbox.HiddenInput aria-label={`Select ${job.awb}`} />
          <Checkbox.Control />
        </Checkbox.Root>
      ),
    },
    { name: "Waybill", render: (job) => <Text fontFamily="mono" fontSize="sm">{job.awb}</Text> },
    { name: "Courier", key: "courier" },
    {
      name: "To",
      render: (job) => (
        <Stack gap="0">
          <Text fontSize="sm">{job.recipient}</Text>
          <Text fontSize="xs" color="fg.muted">
            {job.city}
          </Text>
        </Stack>
      ),
    },
    { name: "Items", key: "items", align: "end" },
    {
      name: "Printed",
      render: (job) =>
        job.printed ? (
          <ToneBadge tone="warning" data-testid="already-printed">
            Already printed
          </ToneBadge>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            —
          </Text>
        ),
    },
  ];

  return (
    <Stack gap="section" p="page" data-testid="print-receipt-page">
      <ScreenHeader
        icon={Printer}
        title="Print shipping labels"
        actions={
          <HStack gap="2">
            <Text fontSize="xs" color="fg.muted">
              {selected.length} selected
            </Text>
            <Button size="xs" disabled={selected.length === 0} data-testid="print">
              <Icon as={Printer} boxSize="4" />
              Print
            </Button>
          </HStack>
        }
      />

      {/* A reprint in the batch is stated before the print, not discovered after it. The number is
          what makes it act as a check rather than a label. */}
      {reprints > 0 && (
        <Alert tone="warning" data-testid="reprint-warning">
          {reprints} of the selected {reprints === 1 ? "label has" : "labels have"} been printed
          before. Two scannable copies of one label is how a parcel goes out under the wrong waybill
          — throw the old one away.
        </Alert>
      )}

      <DataTable
        columns={columns}
        items={jobs}
        loading={loading}
        emptyTitle="Nothing to print"
        aria-label="Shipping labels"
        data-testid="receipt-table"
      />
    </Stack>
  );
}
