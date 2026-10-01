import type { ReactNode } from "react";
import { AbsoluteCenter, Box, Stack, Text } from "@chakra-ui/react";
import { Spinner } from "./Spinner";

// SpinnerOverlay dims a region and centres a spinner over it while an ACTION runs against it.
//
// ⚠ THIS IS NOT `RefreshOverlay`, and the two must not be used interchangeably — they answer
// different questions and look different on purpose:
//
//   RefreshOverlay  — "the rows you are reading are about to be REPLACED by a fresher answer."
//                     A thin indeterminate bar, a light dim, delayed 150ms so a fast refetch never
//                     flickers. The content stays readable, because it is still the best answer
//                     available. This is what every always-fresh list uses.
//
//   SpinnerOverlay  — "an ACTION is running against this panel and you cannot use it until it
//                     finishes." A blocking spinner, shown immediately. The content is context, not
//                     an answer — a bulk status change, a settlement being posted, a file uploading.
//
// Using this one for a list refetch would block a table on every page turn; using the other one for
// a destructive bulk action would leave the buttons live while it ran.
export const description =
  "Blocks a region behind a centred spinner while an ACTION runs against it. For refetches over rows that are still readable, use RefreshOverlay instead.";

export interface SpinnerOverlayProps {
  // Whether the action is running. Unlike RefreshOverlay there is no delay: the point is to stop
  // interaction, and a 150ms window in which the buttons still work is a window for a double-submit.
  busy?: boolean;
  // Shown under the spinner — worth passing whenever the wait is more than a second, since "what is
  // it doing?" is the next question a stalled spinner provokes.
  label?: string;
  children?: ReactNode;
}

export function SpinnerOverlay({ busy, label, children }: SpinnerOverlayProps) {
  if (!busy) return <>{children}</>;

  return (
    <Box position="relative" w="full" data-testid="spinner-overlay" aria-busy>
      <AbsoluteCenter zIndex="1">
        <Stack align="center" gap="2">
          <Spinner />
          {label && (
            <Text fontSize="sm" color="fg.muted">
              {label}
            </Text>
          )}
        </Stack>
      </AbsoluteCenter>

      {/* Interaction off, not just dimmed: the whole reason to block is that a click landing during
          the action would queue a second one. */}
      <Box opacity="0.3" pointerEvents="none">
        {children}
      </Box>
    </Box>
  );
}
