import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Flex, Progress, Stack, Stat, Text } from "@chakra-ui/react";

// THE IMPORT'S LOG — step 3 of the order Import (the-import-is-platform-then-shop-and-file-then-log).
//
// It is the settlement import's progress view said for orders: a bar while the rows are read, the three counts
// of the-import-moves-only-after-handover, the first not-applied rows with their reasons, and every line behind
// Show Log. The not-applied rows are customer service's to-do list, so they are listed before the full log.
//
// It is fed by useOrderImport, which folds ShopeeOrderImport's or TiktokOrderImport's stream into an OrderImportResult.
// The counts are read from `tally`, never parsed out of the lines — the settlement import's rule too.

export type OrderImportLevel = "info" | "warn" | "error";

export interface OrderImportLine {
  level: OrderImportLevel;
  message: string;
}

export interface OrderImportTally {
  moved: number;
  alreadyThere: number;
  notApplied: number;
}

export interface OrderImportResult {
  phase: "running" | "done" | "failed";
  /** Rows read so far, and how many the file has — 0 while the file is still being opened. */
  step: number;
  count: number;
  tally?: OrderImportTally;
  lines: OrderImportLine[];
}

// How many not-applied rows the summary lists before sending the reader to the log for the rest.
const SUMMARY_LINES = 5;

const LEVEL_COLOR: Record<OrderImportLevel, string> = {
  info: "fg.muted",
  warn: "warning.fg",
  error: "error.fg",
};

export function OrderImportLog({ result }: { result: OrderImportResult }) {
  const { t } = useTranslation();
  const [showLog, setShowLog] = useState(false);

  const { phase, step, count, tally, lines } = result;
  const notApplied = lines.filter((l) => l.level === "warn");
  const error = [...lines].reverse().find((l) => l.level === "error");

  return (
    <Stack gap="card" data-testid="order-import-log">
      {/* A failure before the first row has nothing to measure, so it draws no bar — an empty bar under
          "failed" reads as still going. */}
      {(phase === "running" || count > 0) && (
        <Stack gap="1">
          <Text fontSize="sm" data-testid="order-import-progress">
            {count > 0 ? t("orders.import.log.progress", { step, count }) : t("orders.import.log.reading")}
          </Text>
          <Progress.Root value={count > 0 ? step : null} max={Math.max(count, 1)} colorPalette="brand">
            <Progress.Track>
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
        </Stack>
      )}

      {tally && (
        <Flex gap="card" wrap="wrap" data-testid="order-import-tally">
          {(
            [
              ["moved", tally.moved],
              ["alreadyThere", tally.alreadyThere],
              ["notApplied", tally.notApplied],
            ] as const
          ).map(([key, value]) => (
            <Stat.Root key={key} minW="28" data-testid={`order-import-tally-${key}`}>
              <Stat.Label>{t(`orders.import.log.tally.${key}`)}</Stat.Label>
              <Stat.ValueText>{value.toLocaleString()}</Stat.ValueText>
            </Stat.Root>
          ))}
        </Flex>
      )}

      {phase === "failed" && (
        <Box borderWidth="1px" borderColor="error.muted" rounded="l2" p="card" data-testid="order-import-failed">
          <Text fontWeight="bold" color="error.fg">
            {t("orders.import.log.failed")}
          </Text>
          {error && (
            <Text fontSize="sm" color="error.fg" data-testid="order-import-failed-reason">
              {error.message}
            </Text>
          )}
        </Box>
      )}

      {phase === "done" && (
        <Stack gap="1" data-testid="order-import-summary">
          <Text fontWeight="bold">
            {notApplied.length === 0
              ? t("orders.import.log.allApplied")
              : t("orders.import.log.notApplied", { count: notApplied.length })}
          </Text>
          {notApplied.slice(0, SUMMARY_LINES).map((line, i) => (
            <Text key={i} fontSize="sm" color={LEVEL_COLOR.warn} data-testid="order-import-not-applied">
              {line.message}
            </Text>
          ))}
          {notApplied.length > SUMMARY_LINES && (
            <Text fontSize="sm" color="fg.muted" data-testid="order-import-more">
              {t("orders.import.log.moreInLog", { count: notApplied.length - SUMMARY_LINES })}
            </Text>
          )}
        </Stack>
      )}

      {lines.length > 0 && (
        <Box>
          <Button
            size="xs"
            variant="ghost"
            colorPalette="gray"
            data-testid="order-import-log-toggle"
            onClick={() => setShowLog((v) => !v)}
          >
            {showLog ? t("orders.import.log.hideLog") : t("orders.import.log.showLog", { count: lines.length })}
          </Button>
          {showLog && (
            <Stack
              gap="0"
              mt="2"
              maxH="48"
              layerStyle="scrollList"
              fontFamily="mono"
              fontSize="xs"
              borderWidth="1px"
              rounded="l2"
              p="2"
              data-testid="order-import-lines"
            >
              {lines.map((line, i) => (
                <Text key={i} color={LEVEL_COLOR[line.level]}>
                  {line.message}
                </Text>
              ))}
            </Stack>
          )}
        </Box>
      )}
    </Stack>
  );
}
