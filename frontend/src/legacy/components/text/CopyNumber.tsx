import { Clipboard, Text, type TextProps } from "@chakra-ui/react";
import { formatRupiah, formatRupiahCompact } from "../../../lib/money";
import { Tooltip } from "../feedback/Tooltip";
import { CopyText } from "./CopyText";

// What the number MEANS, which decides how it is written:
//   number  — a count; grouped thousands
//   price   — money; rupiah, optionally compacted
//   percent — a rate; one decimal and a % sign
export type NumberKind = "number" | "price" | "percent";

// formatNumber is the display form. Note it is never what gets copied — see the component below.
function formatNumber(value: number, kind: NumberKind, compact?: boolean): string {
  switch (kind) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "price": {
      const asMoney = BigInt(Math.round(value));
      return compact ? formatRupiahCompact(asMoney) : formatRupiah(asMoney);
    }
    default:
      return value.toLocaleString("id-ID");
  }
}

// CopyNumber renders a formatted number with a copy button that copies the RAW value.
//
// That split is the whole reason this exists rather than `<CopyText>{formatted}</CopyText>`. What
// is worth READING is "Rp 1,5jt"; what is worth PASTING is `1500000`. Copying the display form
// hands the next system a string with a currency prefix, thousand separators and possibly a `jt`
// suffix — none of which a spreadsheet cell, a marketplace form or a search box will accept. Every
// one of those pastes then has to be hand-cleaned, which is exactly the work the copy button was
// supposed to remove.
export const description =
  "A formatted number (count, rupiah, or percent) with a copy button that puts the RAW value on the clipboard — you read 'Rp 1,5jt' and paste '1500000'.";

export interface CopyNumberProps {
  value?: number;
  kind?: NumberKind;
  // Compact the PRICE form. Ignored for counts and percentages, which are already short.
  compact?: boolean;
  // Wrap the formatted text, e.g. "≈ " / " /day".
  addon?: string;
  addonAppend?: string;
  disabled?: boolean;
}

export function CopyNumber({
  value = 0,
  kind = "number",
  compact,
  addon,
  addonAppend,
  disabled,
}: CopyNumberProps) {
  const shown = `${addon ?? ""}${formatNumber(value, kind, compact)}${addonAppend ?? ""}`;
  // Compacting hid digits, so the exact figure stays reachable — same contract as PriceText.
  const exact = compact && kind === "price" ? formatRupiah(BigInt(Math.round(value))) : undefined;

  return (
    <CopyText copyText={String(value)} disabled={disabled} label="Copy value" copiedLabel="Value copied">
      <Tooltip content={exact}>
        <Text as="span" fontVariantNumeric="tabular-nums" data-testid="copy-number">
          {shown}
        </Text>
      </Tooltip>
    </CopyText>
  );
}

// CopyNumberPlain is the same idea with NO chrome: the number itself is the click target.
//
// It is for dense places — a statistic tile, a totals row, a chart axis label — where a button
// beside every figure would out-weigh the figures. The trade-off is honest: with nothing but a
// `cursor: copy` to advertise it, the affordance is discoverable only by hovering, so the tooltip
// carries the instruction. Use the chromed CopyText/CopyNumber wherever the copy is the point
// rather than a convenience.
export const plainDescription =
  "A number where the text itself is the copy target — no button. For dense tiles and totals rows, where a button per figure would outweigh the figures.";

export interface CopyNumberPlainProps extends Omit<TextProps, "children" | "onCopy"> {
  value?: number;
  kind?: NumberKind;
  compact?: boolean;
}

export function CopyNumberPlain({
  value = 0,
  kind = "number",
  compact,
  ...rest
}: CopyNumberPlainProps) {
  return (
    <Clipboard.Root
      value={String(value)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      display="inline-flex"
      w="fit-content"
    >
      <Clipboard.Context>
        {({ copied }) => (
          <Tooltip content={copied ? "Value copied" : "Click to copy"}>
            <Clipboard.Trigger asChild>
              <Text
                as="span"
                cursor="copy"
                fontVariantNumeric="tabular-nums"
                whiteSpace="nowrap"
                data-testid="copy-number-plain"
                {...rest}
              >
                {formatNumber(value, kind, compact)}
              </Text>
            </Clipboard.Trigger>
          </Tooltip>
        )}
      </Clipboard.Context>
    </Clipboard.Root>
  );
}
