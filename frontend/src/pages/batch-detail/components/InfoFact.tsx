import type { ReactNode } from "react";
import { Box, Stack, Text } from "@chakra-ui/react";

// ONE FACT OF A BATCH'S INFO, AS THE OWNER DREW IT (owner, with a picture: *"untuk info batchnya kurang lebih seperti ini
// designnya"*, the-batch-info-reads-label-over-value) — the label quiet and plain, the value under it in bold, the facts
// parted by a thin line (the list's `separator`):
//
//   Dari
//   Restok #7
//   ─────────────
//   Diterima oleh
//   Dev Superuser
//
// The shared `Fact` (a bold 12px label over a plain value) is every other page's, and stays — this is the batch's Info.
// A value that is absent is a dash, as `Fact`'s: a missing value and an empty string read differently.
export function InfoFact({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children === undefined || children === null || children === "";

  return (
    <Stack gap="1" minW="0">
      <Text fontSize="sm" color="fg.muted">
        {label}
      </Text>
      {empty ? (
        <Text color="fg.subtle">—</Text>
      ) : (
        <Box fontWeight="bold" minW="0">
          {children}
        </Box>
      )}
    </Stack>
  );
}
