import { Button, HStack, Icon, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Printer } from "lucide-react";
import { Alert } from "../../../legacy/components/display/Alert";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { BarcodeLabel } from "../../fixtures";

// ── PRINT BARCODES ──────────────────────────────────────────────────────────────────────────────
//
// A sheet of labels, and nothing else. It mounts OUTSIDE the shell — no sidebar, no top bar, no
// navigation — and that is the design, not an oversight.
//
// ⚠ THE SCREEN *IS* THE PRINT OUTPUT. It is opened in its own window from the inbound screen, sent
// to a printer, and closed. Every pixel of app chrome on it is either wasted paper or a thing that
// has to be hidden with a print stylesheet — and a print stylesheet that hides a sidebar is a rule
// somebody has to remember to update forever.
//
// Mounting outside the shell makes the problem not exist. The trade-off is that there is no way back
// except closing the window, which is correct here: it was opened to produce paper, and once the
// paper exists there is nothing more to do on it.
//
// ⚠ THE BARCODE IS RENDERED AS A PICTURE OF ITSELF, and the human-readable code sits under it. Both
// are needed: the scanner reads the bars, and a person reads the digits when the label is scuffed
// and the scanner will not take it — which on a warehouse floor is a daily occurrence, not an edge
// case.
export const description =
  "A sheet of labels and nothing else — mounted outside the shell, because the screen IS the print output and app chrome on it is wasted paper. The human-readable code sits under every barcode, for when the label is too scuffed to scan.";

export interface PrintBarcodePageProps {
  labels: BarcodeLabel[];
  // Labels per row on the sheet. Matches the physical stationery, which is why it is a number and
  // not a breakpoint.
  perRow?: number;
}

export function PrintBarcodePage({ labels, perRow = 3 }: PrintBarcodePageProps) {
  return (
    <Stack gap="section" p="page" data-testid="print-barcode-page">
      <ScreenHeader
        icon={Printer}
        title="Print barcodes"
        actions={
          <HStack gap="2">
            <Text fontSize="xs" color="fg.muted">
              {labels.length} {labels.length === 1 ? "label" : "labels"}
            </Text>
            <Button size="xs" data-testid="print">
              <Icon as={Printer} boxSize="4" />
              Print
            </Button>
          </HStack>
        }
      />

      {labels.length === 0 ? (
        <Alert tone="warning" data-testid="nothing-selected">
          Nothing selected to print. Go back to Inbound, tick the rows you want labels for, and
          choose Print barcodes.
        </Alert>
      ) : (
        <SimpleGrid columns={perRow} gap="2" data-testid="label-sheet">
          {labels.map((label) => (
            <Stack
              key={label.code}
              gap="1"
              borderWidth="1px"
              borderRadius="sm"
              p="2"
              align="center"
              data-testid="label"
            >
              <Text fontSize="xs" fontWeight="medium" lineClamp={1} maxW="full">
                {label.product}
              </Text>
              {label.variant && (
                <Text fontSize="2xs" color="fg.muted">
                  {label.variant}
                </Text>
              )}

              <Barcode value={label.code} />

              {/* ⚠ THE DIGITS UNDER THE BARS ARE NOT DECORATION. A scuffed label that the scanner
                  refuses is a daily occurrence, and this is what gets typed in instead. */}
              <Text fontFamily="mono" fontSize="2xs" letterSpacing="wide" data-testid="human-readable">
                {label.code}
              </Text>
            </Stack>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

// A drawn stand-in for the real symbology. Deterministic from the code so the same SKU always looks
// the same on screen, which is what makes the sheet reviewable — a random pattern would make every
// re-render look like a different label.
function Barcode({ value }: { value: string }) {
  const bars = Array.from(value).flatMap((char, i) => {
    const n = char.charCodeAt(0) + i;
    return [((n % 3) + 1) * 1.2, ((n % 2) + 1) * 1.2];
  });

  let x = 0;

  return (
    <svg width="100%" height="40" role="img" aria-label={`Barcode ${value}`} data-testid="barcode">
      {bars.map((width, i) => {
        const bar = (
          <rect key={i} x={x} y={0} width={i % 2 === 0 ? width : 0} height={40} fill="currentColor" />
        );
        x += width;
        return bar;
      })}
    </svg>
  );
}
