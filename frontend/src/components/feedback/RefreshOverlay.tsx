import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Box, Progress } from "@chakra-ui/react";

export const description =
  "Wraps a table or list that is being refetched: runs a thin indeterminate bar above it and dims the content, so the rows on screen read as the previous answer while a fresher one loads. Pairs with `listQuery` — the app is always-fresh, and this is what stops that from flickering.";

export interface RefreshOverlayProps {
  /**
   * True while a REFETCH is in flight over content that is already on screen.
   *
   * ⚠ Pass `query.isFetching && !query.isPending`, never `isFetching` alone. On a genuine first load
   * there are no rows to dim — the page should be showing its own loading state, and dimming an empty
   * table behind a progress bar is two loading indicators for one wait.
   */
  busy: boolean;
  children: ReactNode;
}

// A refetch that answers in 80ms must not flash the screen, and with `staleTime: 0` every tab switch,
// every page turn and every remount refetches — so an undelayed overlay would flicker on essentially
// every interaction. The bar and the dim appear only if the fetch is STILL running after this long;
// they clear the instant it finishes, so a slow request is never left looking finished.
const SHOW_AFTER_MS = 150;

function useSlowFetch(busy: boolean): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }

    const timer = setTimeout(() => setSlow(true), SHOW_AFTER_MS);

    return () => clearTimeout(timer);
  }, [busy]);

  return slow;
}

// RefreshOverlay is the app's ONE answer to "the rows you are reading are about to be replaced" (the
// always-fresh decision in api/queryClient.ts).
//
// Both halves are load-bearing. The BAR says a request is running; the DIM says the rows beneath it
// are the previous answer. The bar alone leaves stale rows looking fully live and clickable, and the
// dim alone is ambiguous with a disabled state.
//
// The bar sits in normal flow rather than absolutely over the content: it is 2px tall and always
// occupies that space, so appearing and disappearing never shifts the table by a pixel. Overlaying it
// instead would put it on top of the first row.
export function RefreshOverlay({ busy, children }: RefreshOverlayProps) {
  const show = useSlowFetch(busy);

  return (
    <Box data-testid="refresh-overlay" data-busy={show ? "true" : undefined}>
      <Progress.Root
        // `null` is Chakra's indeterminate — a duration is not knowable here, and a bar that animated
        // towards a number the app invented would be a lie about progress.
        value={show ? null : 0}
        size="xs"
        colorPalette="brand"
        opacity={show ? 1 : 0}
        transition="opacity 120ms"
        aria-hidden={!show}
      >
        <Progress.Track bg="transparent" borderRadius="0">
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>

      {/* `pointerEvents` off while refreshing: the rows are about to be replaced, and a click landing
          on row 3 of the OLD answer would open whatever row 3 turns out to be in the new one. */}
      <Box
        aria-busy={show}
        opacity={show ? 0.55 : 1}
        pointerEvents={show ? "none" : undefined}
        transition="opacity 120ms"
      >
        {children}
      </Box>
    </Box>
  );
}
