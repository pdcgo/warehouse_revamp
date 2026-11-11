import type { ReactNode } from "react";
import { Box, Grid, HStack, Stack, Text } from "@chakra-ui/react";

/** One row of a figures list — a label, the figure, and what it means beside it. */
export interface FigureRow {
  key: string;
  label: string;
  value: ReactNode;
  line?: string;
  /** A ⚠ beside the label, for a figure that is invented. */
  mark?: ReactNode;
  testId?: string;
}

/**
 * A list of figures, ONE PER LINE, DOWN (owner: *"data stat ready, ongoing jangan jadi 4, 1 1 ke bawah"*) — the label,
 * then the figure and what it is worth beside it. The product page's Info and its warehouse Overview read this way, and
 * the discover detail's Info with them (the-discover-detail-is-the-product-page).
 */
export function FigureRows({ rows, prefix }: { rows: FigureRow[]; prefix: string }) {
  return (
    <Stack gap="0" data-testid={prefix}>
      {rows.map((f) => (
        <Grid
          key={f.key}
          templateColumns="8rem minmax(0, 1fr)"
          gap="card"
          alignItems="baseline"
          py="2"
          borderBottomWidth="1px"
          borderColor="border.muted"
          data-testid={`${prefix}-${f.key}`}
        >
          <HStack gap="1" align="center">
            <Text fontSize="xs" fontWeight="bold" color="fg.label">
              {f.label}
            </Text>
            {f.mark}
          </HStack>
          <HStack gap="2" minW="0" align="baseline" wrap="wrap">
            <Box fontWeight="bold" data-testid={f.testId}>
              {f.value || "—"}
            </Box>
            {f.line && (
              <Text fontSize="xs" color="fg.muted" minW="0">
                {f.line}
              </Text>
            )}
          </HStack>
        </Grid>
      ))}
    </Stack>
  );
}
