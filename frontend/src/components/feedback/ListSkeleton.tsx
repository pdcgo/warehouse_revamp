import { Box, HStack, Skeleton, Stack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

export const description =
  "What a list shows while its FIRST page loads: grey bars where the rows will be, pulsing, in the shape of a row — instead of a spinner on an empty page. `heading` adds a title and a line over them, for a detail page that has nothing to show yet. Only for the first load: a refresh keeps the rows already on screen (HARD RULE 10), so this never stands in for data the person was reading. The rows that replace it fade in where the bars were.";

// The first column's bar, per row — uneven, the way names are, so it reads as rows and not as a striped box.
const NAME_WIDTH = ["72%", "56%", "84%", "64%", "76%"];

// WHILE THE FIRST PAGE LOADS, THE SHAPE OF IT (owner: *"animasi juga atau transisi, sekarang terlihat flat"*,
// `motion-is-small-quick-and-shared`):
//
//   ▆▆▆▆▆▆▆▆▆▆▆▆▆            ▆▆▆▆▆      ▆▆▆▆▆
//   ▆▆▆▆▆▆▆▆▆                ▆▆▆▆▆      ▆▆▆▆▆
//   ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆          ▆▆▆▆▆      ▆▆▆▆▆
//
// Chakra's Skeleton (it pulses on its own); a name column and two figures, divided like table rows.
export function ListSkeleton({
  rows = 5,
  heading = false,
  testId = "list-skeleton",
}: {
  rows?: number;
  /** A title and a line over the rows — a detail page whose record has not arrived. */
  heading?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="section" role="status" aria-label={t("common.loading")} data-testid={testId}>
      {heading && (
        <Stack gap="2">
          <Skeleton h="7" w="40%" />
          <Skeleton h="4" w="60%" />
        </Stack>
      )}
      <Stack gap="0">
        {Array.from({ length: rows }, (_, i) => (
          <HStack key={i} gap="4" py="3" borderBottomWidth="1px" borderColor="border.muted">
            <Box flex="3">
              <Skeleton h="4" w={NAME_WIDTH[i % NAME_WIDTH.length]} />
            </Box>
            <Skeleton h="4" flex="1" />
            <Skeleton h="4" flex="1" />
          </HStack>
        ))}
      </Stack>
    </Stack>
  );
}
