import { Text, type TextProps } from "@chakra-ui/react";
import { formatRupiah, formatRupiahCompact } from "../../../lib/money";
import { Tooltip } from "../feedback/Tooltip";

// PriceText renders money, compacting it once it gets long and keeping the exact figure one hover
// away.
//
// Money columns are where a table stops being scannable. At full precision every amount is a wall
// of digits of near-identical width, so telling "Rp 1.500.000" from "Rp 15.000.000" means counting
// groups. Compacting to "Rp 1,5jt" puts the magnitude first — which is what someone scanning a
// column is actually asking.
//
// ⚠ Compact LOSES PRECISION, so the exact amount is always still reachable: whenever the component
// compacts, it attaches a tooltip carrying the full `formatRupiah` value. Compacting without that
// tooltip would be a screen that quietly rounds the numbers people reconcile against.
//
// Below the threshold nothing is compacted and no tooltip is attached — the full value is already
// on screen, and a tip repeating it is noise.
export const description =
  "Money that compacts above a threshold (Rp 1,5jt) and always keeps the exact amount in a tooltip. Below the threshold it renders in full, with no tooltip.";

export interface PriceTextProps extends Omit<TextProps, "children"> {
  amount?: bigint;
  // Compact once the absolute value exceeds this. The default keeps four-digit rupiah amounts
  // exact — those are short enough to read and precise enough to matter.
  minCompact?: bigint;
  // A prefix carried into the tooltip too, e.g. "-" or "≈".
  addon?: string;
  // Suppress the tooltip. Only for a place that already shows the exact figure beside this one.
  hideTooltip?: boolean;
}

export function PriceText({
  amount = 0n,
  minCompact = 9_999n,
  addon,
  hideTooltip,
  ...rest
}: PriceTextProps) {
  const abs = amount < 0n ? -amount : amount;
  const compact = abs > minCompact;

  const shown = compact ? formatRupiahCompact(amount) : formatRupiah(amount);
  // The tooltip exists to recover what compacting threw away — so there is nothing to say when
  // nothing was thrown away.
  const exact = compact && !hideTooltip ? `${addon ?? ""}${formatRupiah(amount)}` : undefined;

  return (
    <Tooltip content={exact}>
      <Text
        as="span"
        fontVariantNumeric="tabular-nums"
        whiteSpace="nowrap"
        data-testid="price-text"
        data-compact={compact ? "true" : "false"}
        {...rest}
      >
        {addon}
        {shown}
      </Text>
    </Tooltip>
  );
}
