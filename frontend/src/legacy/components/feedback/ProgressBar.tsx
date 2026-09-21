import { Progress } from "@chakra-ui/react";
import type { ProgressRootProps } from "@chakra-ui/react";
import { palette, type Tone } from "../tone";

// ProgressBar is a determinate bar carrying a design-system tone: how full something is, and whether
// that is good news.
//
// The tone is the reason it exists rather than callers using Chakra's Progress directly. A bar in
// this app almost always shows a limit being consumed — a credit ceiling, a rack's capacity, a
// picking run's completion — and "76% full" means something very different at 76% of a payment limit
// than at 76% of a picking run. The caller decides what it means and passes the tone; the bar renders
// it consistently.
//
// The value is CLAMPED to 0–100. An over-limit figure is real (an account can exceed its ceiling)
// and would otherwise paint a bar wider than its own track — so the bar pins at full and the number
// beside it, not the geometry, carries the overage.
export const description =
  "A determinate progress bar in one of the design tones. Clamps over-100% values to a full bar rather than overflowing its track.";

export interface ProgressBarProps extends Omit<ProgressRootProps, "value" | "colorPalette"> {
  // 0–100. Values outside that range are clamped, not rejected.
  percent: number;
  tone?: Tone;
  // Fill from the right. For a bar that reads as depletion rather than accumulation.
  direction?: "ltr" | "rtl";
}

export function ProgressBar({
  percent,
  tone = "active",
  direction = "ltr",
  size = "sm",
  ...rest
}: ProgressBarProps) {
  const value = Math.min(100, Math.max(0, Math.abs(percent)));

  return (
    <Progress.Root
      value={value}
      size={size}
      colorPalette={palette(tone, "active")}
      data-testid="progress-bar"
      data-percent={value}
      {...rest}
    >
      <Progress.Track dir={direction === "rtl" ? "rtl" : undefined}>
        <Progress.Range />
      </Progress.Track>
    </Progress.Root>
  );
}
