import { useCallback, useMemo, useRef, useState } from "react";
import { Box, Button, Flex, HStack, Icon, Stack, Switch, Text } from "@chakra-ui/react";
import { ScanLine, Volume2, VolumeX } from "lucide-react";
import { ToneBadge } from "../../../legacy/components/badges/ToneBadge";
import { EmptyHint } from "../../../legacy/components/feedback/EmptyHint";
import { SCAN_OUTCOME_LABEL, SCAN_OUTCOME_TONE, type ScanOutcome } from "../../status";
import { createScanFeedback } from "./scanFeedback";
import { useScanListener } from "./useScanListener";

// ── THE SCAN STATION ────────────────────────────────────────────────────────────────────────────
//
// The screen an operator stands in front of with a scanner. Four of the floor app's screens are one
// of these with a different resolver behind it — dispatch scanning, bulk pick by AWB, bulk pick by
// product, and pre-send tracking — so it is ONE component here rather than four near-copies, which
// is what the original has.
//
// It owns three things and nothing else:
//
//   1. the listener       — document-level, no focused input (see useScanListener)
//   2. the running tally  — what has been scanned and how each one came back
//   3. the feedback       — a sound per outcome, and the same outcome as a visible row
//
// What a scan MEANS is the caller's job: `resolve` turns a code into an outcome plus a line of
// detail. The station does not know what an AWB is.
export const description =
  "The scanner screen: a document-level listener (no focused input), a running tally of outcomes, and audible + visible feedback per scan. Four floor screens are this component with a different resolver.";

export interface ScanResult {
  code: string;
  outcome: ScanOutcome;
  // One line about what was scanned — the product, the order, the shelf. Shown beside the code.
  detail?: string;
}

export interface ScanStationProps {
  // Turn a scanned code into a result. Sync on purpose: the reference port has no backend, and the
  // real one awaits a lookup here.
  resolve(code: string): Omit<ScanResult, "code">;
  title?: string;
  // The state a scan must already be in to be accepted. On the dispatch station this is "packed",
  // and it is the difference between handing the courier a finished parcel and losing an unfinished
  // one — see `wrong_status`.
  gate?: string;
  onGateChange?(enabled: boolean): void;
  gateEnabled?: boolean;
  enabled?: boolean;
}

export function ScanStation({
  resolve,
  title = "Scan station",
  gate,
  gateEnabled = true,
  onGateChange,
  enabled = true,
}: ScanStationProps) {
  const [results, setResults] = useState<ScanResult[]>([]);
  const [buffer, setBuffer] = useState("");
  const [armed, setArmed] = useState(false);

  // ⚠ REPEATS ARE COUNTED SEPARATELY, BECAUSE THEY PRODUCE NO ROW.
  //
  // A repeat does not append to the list — the parcel is already banked and a second row for it
  // would be a lie about how many are done. But the COUNT still matters to the operator: repeats
  // climbing means the stack has been shuffled and they have lost their place, which is worth
  // seeing before they reach the end and find a shortfall. So it is its own number, not a filter
  // over the rows.
  const [duplicates, setDuplicates] = useState(0);

  // The list, readable synchronously. The scan handler has to decide "have I seen this?" and act on
  // the answer with a sound; doing that inside a state updater makes the updater impure, and React
  // is free to invoke it twice — which double-plays the sound and double-counts the repeat.
  const seenRef = useRef(new Set<string>());

  // Rebuilt when `armed` flips so a station armed mid-session starts sounding, and the stories can
  // assert on what the last scan tried to play.
  const feedback = useMemo(() => createScanFeedback({ armed }), [armed]);

  const onScan = useCallback(
    (code: string) => {
      // ⚠ A REPEAT SCAN IS NOT AN ERROR. Losing your place in a stack of parcels and re-scanning one
      // is ordinary, and answering it with the error buzz trains the operator to ignore the error
      // buzz. It gets its own outcome and its own sound, and the original row stays put rather than
      // being replaced — the position in the list is how they find it again.
      if (seenRef.current.has(code)) {
        feedback.play("duplicate");
        setDuplicates((n) => n + 1);
        return;
      }

      seenRef.current.add(code);
      const resolved = resolve(code);
      feedback.play(resolved.outcome);
      // Newest first: the operator is looking at what they just did, not at what they did first.
      setResults((prev) => [{ code, ...resolved }, ...prev]);
    },
    [resolve, feedback],
  );

  useScanListener({ onScan, enabled, onBuffer: setBuffer });

  const tally = useMemo(() => {
    const counts: Partial<Record<ScanOutcome, number>> = { duplicate: duplicates };
    for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    return counts;
  }, [results, duplicates]);

  return (
    <Stack gap="section" data-testid="scan-station">
      <Flex justify="space-between" align="center" gap="3" wrap="wrap">
        <HStack gap="2">
          <Icon as={ScanLine} boxSize="5" color="fg.muted" />
          <Text fontWeight="medium">{title}</Text>
        </HStack>

        <HStack gap="3">
          {gate && (
            <Switch.Root
              checked={gateEnabled}
              onCheckedChange={(e) => onGateChange?.(e.checked)}
              size="sm"
              data-testid="scan-gate"
            >
              <Switch.HiddenInput />
              <Switch.Control />
              <Switch.Label fontSize="sm">{gate}</Switch.Label>
            </Switch.Root>
          )}

          {/* ⚠ ARMING IS A VISIBLE CONTROL, NOT A SIDE EFFECT. Browsers block audio until the page
              has been interacted with, so the first scan of a session would be silent — and a
              silent scan reads as an accepted one. The operator arms it deliberately and can see
              that they have. */}
          <Button
            size="xs"
            variant={armed ? "subtle" : "outline"}
            colorPalette={armed ? "green" : "gray"}
            onClick={() => setArmed((a) => !a)}
            data-testid="scan-arm"
            aria-label={armed ? "Sound on" : "Sound off"}
          >
            <Icon as={armed ? Volume2 : VolumeX} boxSize="4" />
            {armed ? "Sound on" : "Sound off"}
          </Button>
        </HStack>
      </Flex>

      {/* The buffer. The original shows nothing at all while a code is arriving, so a scanner that
          is mis-reading — a scuffed label, the wrong symbology — looks identical to one that is not
          firing. Here the characters land visibly as they come in. */}
      <Box
        borderWidth="1px"
        borderStyle="dashed"
        borderRadius="md"
        px="4"
        py="6"
        textAlign="center"
        bg="bg.subtle"
        data-testid="scan-buffer"
      >
        <Text fontFamily="mono" fontSize="lg" color={buffer ? "fg" : "fg.muted"}>
          {buffer || (enabled ? "Ready — scan a code" : "Scanning paused")}
        </Text>
        <Text fontSize="xs" color="fg.muted" mt="1">
          No cursor needed. Point and scan.
        </Text>
      </Box>

      <HStack gap="2" wrap="wrap" data-testid="scan-tally">
        {(Object.keys(SCAN_OUTCOME_LABEL) as ScanOutcome[]).map((outcome) => (
          <ToneBadge key={outcome} tone={SCAN_OUTCOME_TONE[outcome]} data-testid={`tally-${outcome}`}>
            {SCAN_OUTCOME_LABEL[outcome]} {tally[outcome] ?? 0}
          </ToneBadge>
        ))}
      </HStack>

      {results.length === 0 ? (
        <EmptyHint icon={ScanLine} title="Nothing scanned yet" />
      ) : (
        <Stack gap="1" data-testid="scan-results">
          {results.map((r) => (
            <Flex
              key={r.code}
              justify="space-between"
              align="center"
              gap="3"
              borderWidth="1px"
              borderRadius="md"
              px="3"
              py="2"
              data-testid="scan-result"
            >
              <Stack gap="0">
                <Text fontFamily="mono" fontSize="sm">
                  {r.code}
                </Text>
                {r.detail && (
                  <Text fontSize="xs" color="fg.muted">
                    {r.detail}
                  </Text>
                )}
              </Stack>
              <ToneBadge tone={SCAN_OUTCOME_TONE[r.outcome]}>{SCAN_OUTCOME_LABEL[r.outcome]}</ToneBadge>
            </Flex>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
