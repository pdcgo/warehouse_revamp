import { useState } from "react";
import { Button, Field, HStack, Icon, NativeSelect, NumberInput, Stack, Text } from "@chakra-ui/react";
import { Printer } from "lucide-react";
import { Card } from "../../../legacy/components/display/Card";
import { RackChip } from "../../components/display/RackChip";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { BarcodeLabel } from "../../fixtures";

// ── PRINT BARCODES, THE REWRITE ─────────────────────────────────────────────────────────────────
//
// Same output, one label at a time, with the two settings that actually get changed.
//
// ⚠ THE WHOLE DIFFERENCE IS THAT IT ASKS "HOW MANY" AND "WHAT SIZE".
//
// The original sheet screen (`print-barcode`) prints exactly one label per selected item, on
// whatever stationery is loaded. That is fine when you are labelling four SKUs and wrong the moment
// you receive a carton of forty identical units — which is the normal case, not the exception. The
// operator's actual request is "forty of this one", and the sheet screen makes them select the same
// row forty times or print forty sheets.
//
// The size selector is the same kind of omission: the warehouse has two label stocks, and printing
// a 100mm design onto 58mm stock wastes the roll and the half hour it takes to notice.
//
// ⚠ AND THE THING BOTH VERSIONS GET RIGHT: no shell, and the screen is the output. Kept.
//
// This is the clearest small example in the port of the pattern behind every rewrite in this app —
// the original built the thing, and the rewrite added the quantity.
export const description =
  "One label, many copies. The rewrite of the sheet screen, and the whole difference is that it asks HOW MANY and WHAT SIZE — the sheet version prints one per selected row, which is wrong the moment a carton of forty identical units arrives.";

export type LabelSize = "58mm" | "100mm";

export interface PrintBarcodeV2PageProps {
  label: BarcodeLabel;
  copies?: number;
  size?: LabelSize;
}

export function PrintBarcodeV2Page({ label, copies: initialCopies = 1, size: initialSize = "58mm" }: PrintBarcodeV2PageProps) {
  const [copies, setCopies] = useState(initialCopies);
  const [size, setSize] = useState<LabelSize>(initialSize);

  return (
    <Stack gap="section" p="page" data-testid="print-barcode-v2-page">
      <ScreenHeader
        icon={Printer}
        title="Print barcode"
        actions={
          <Button size="xs" data-testid="print">
            <Icon as={Printer} boxSize="4" />
            Print {copies}
          </Button>
        }
      />

      <Card>
        <Stack gap="field">
          <Stack gap="0">
            <Text fontWeight="medium">{label.product}</Text>
            {label.variant && (
              <Text fontSize="sm" color="fg.muted">
                {label.variant}
              </Text>
            )}
            <Text fontFamily="mono" fontSize="sm" mt="1">
              {label.sku}
            </Text>
          </Stack>

          {/* Where it is going. Shown because the person printing a label is usually about to walk
              the goods to a shelf, and the two acts are the same errand. */}
          <HStack>
            <RackChip rack={label.rack} />
          </HStack>

          <HStack gap="4" align="end">
            <Field.Root maxW="32">
              <Field.Label>Copies</Field.Label>
              <NumberInput.Root
                size="sm"
                min={1}
                max={500}
                value={String(copies)}
                onValueChange={(e) => setCopies(e.valueAsNumber || 1)}
                data-testid="copies"
              >
                <NumberInput.Control />
                <NumberInput.Input />
              </NumberInput.Root>
              {/* The reason the rewrite exists, stated where it is used. */}
              <Field.HelperText>One per unit received.</Field.HelperText>
            </Field.Root>

            <Field.Root maxW="40">
              <Field.Label>Label size</Field.Label>
              <NativeSelect.Root size="sm" data-testid="size">
                <NativeSelect.Field
                  value={size}
                  onChange={(e) => setSize(e.currentTarget.value as LabelSize)}
                  aria-label="Label size"
                >
                  <option value="58mm">58mm roll</option>
                  <option value="100mm">100mm roll</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              <Field.HelperText>Must match the stock in the printer.</Field.HelperText>
            </Field.Root>
          </HStack>
        </Stack>
      </Card>

      {/* A preview of one, at the chosen size. One is enough — the sheet is forty of this, and
          rendering forty identical previews tells the operator nothing they cannot already see. */}
      <Card data-testid="preview" data-size={size}>
        <Stack gap="1" align="center" w={size === "58mm" ? "58mm" : "100mm"} maxW="full" mx="auto">
          <Text fontSize="xs" fontWeight="medium" lineClamp={1}>
            {label.product}
          </Text>
          <svg width="100%" height="48" role="img" aria-label={`Barcode ${label.code}`} data-testid="barcode">
            {Array.from(label.code).map((char, i) => (
              <rect
                key={i}
                x={i * 6}
                y={0}
                width={((char.charCodeAt(0) % 3) + 1) * 1.4}
                height={48}
                fill="currentColor"
              />
            ))}
          </svg>
          <Text fontFamily="mono" fontSize="2xs" letterSpacing="wide">
            {label.code}
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
