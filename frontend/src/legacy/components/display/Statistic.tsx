import type { ElementType, ReactNode } from "react";
import { Icon, Stat } from "@chakra-ui/react";
import { BarChart3 } from "lucide-react";
import { Spinner } from "../feedback/Spinner";
import { palette, type Tone } from "../tone";
import { Card } from "./Card";

// Statistic is one headline number in a card — the tiles across the top of a dashboard.
//
// Two details do most of the work:
//
//  1. THE NUMBER IS TABULAR-NUMS. Proportional digits are different widths, so a figure that ticks
//     from 999 to 1,000 shifts everything after it, and a row of tiles never quite lines up. In a
//     panel that refreshes this is a visible jitter.
//  2. LOADING SHOWS A SPINNER BESIDE THE LABEL, NOT INSTEAD OF THE NUMBER. Replacing the value
//     collapses the tile's height and makes the whole dashboard jump on every refresh; the previous
//     number stays, marked as being re-read. Same reasoning as the always-fresh list rule.
export const description =
  "One headline number in a card, with an icon and an optional trend. Refreshing keeps the previous number on screen so the dashboard does not jump.";

export interface StatisticProps {
  title: string;
  children?: ReactNode;
  // A lucide component, shown large and faint behind the top-right corner.
  icon?: ElementType;
  tone?: Tone;
  loading?: boolean;
  // A supporting line under the number — a comparison, a period, a share.
  help?: ReactNode;
  // Direction of change, drawn as Chakra's up/down indicator beside `help`.
  trend?: "up" | "down";
}

export function Statistic({
  title,
  children,
  icon = BarChart3,
  tone = "active",
  loading,
  help,
  trend,
}: StatisticProps) {
  return (
    <Card position="relative" overflow="hidden" data-testid="statistic" flex="1" minW="48">
      <Stat.Root>
        <Stat.Label display="flex" alignItems="center" gap="1">
          {title}
          {/* Beside the label, never in place of the value — see rule 2. */}
          {loading && <Spinner size="sm" tone={tone} />}
        </Stat.Label>

        <Stat.ValueText fontVariantNumeric="tabular-nums" opacity={loading ? 0.6 : 1}>
          {children}
        </Stat.ValueText>

        {(help || trend) && (
          <Stat.HelpText>
            {trend === "up" && <Stat.UpIndicator />}
            {trend === "down" && <Stat.DownIndicator />}
            {help}
          </Stat.HelpText>
        )}
      </Stat.Root>

      {/* Decorative, and marked as such: the icon repeats what the label already says, so a screen
          reader announcing it would just be noise. */}
      <Icon
        as={icon}
        aria-hidden
        position="absolute"
        top="50%"
        insetEnd="3"
        transform="translateY(-50%)"
        boxSize="10"
        opacity="0.15"
        colorPalette={palette(tone, "active")}
        color="colorPalette.solid"
      />
    </Card>
  );
}
