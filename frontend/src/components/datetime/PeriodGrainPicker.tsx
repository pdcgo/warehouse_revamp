import { useTranslation } from "react-i18next";
import { SegmentGroup } from "@chakra-ui/react";

import type { PeriodGrain } from "../../lib/period";

/** Every grain, coarsening — the default offer, and the order they are shown in. */
export const PERIOD_GRAINS: PeriodGrain[] = ["day", "month", "year"];

export interface PeriodGrainPickerProps {
  value: PeriodGrain;
  onChange: (grain: PeriodGrain) => void;
  /**
   * Which grains to offer, in order. Defaults to all three.
   *
   * A caller narrows this when its DATA cannot answer at a grain — not when the grain is merely
   * uninteresting. Offering a resolution the series cannot fill is how a screen ends up showing one
   * row and looking broken.
   */
  grains?: PeriodGrain[];
  disabled?: boolean;
  /** Distinguishes two instances on one page, and names the segments: `${testId}-month`. */
  testId?: string;
}

// PeriodGrainPicker — how coarse a row is: Daily, Monthly, Yearly.
//
// It lives beside DateRangePicker because the two are read as one control: a window and the resolution
// it is drawn at. Picking a period without saying at what grain answers half a question, and every
// screen that has grown one has put them side by side.
//
// A SEGMENTED GROUP rather than a Select — the one place in this folder that is not a popover. There
// are exactly three options and the choice changes the whole table beneath it, so all three are worth
// seeing without opening anything: a reader who cannot tell at a glance that they are looking at MONTHS
// will read a running total as a month's worth of days.
export const description =
  "Period-grain picker (Chakra SegmentGroup) — Daily / Monthly / Yearly. Emits a PeriodGrain, the same union lib/period's bucketOf and bucketSpine take, so a caller rolls a daily series up without a mapping table. Segmented rather than a dropdown because the choice reframes everything below it and all three options should be readable at a glance. Narrow the offer with `grains` when the underlying series cannot answer at a resolution.";

export function PeriodGrainPicker({
  value,
  onChange,
  grains = PERIOD_GRAINS,
  disabled,
  testId = "period-grain",
}: PeriodGrainPickerProps) {
  const { t } = useTranslation();

  return (
    <SegmentGroup.Root
      value={value}
      // Ark emits `null` when the active segment is clicked again; a grain has no "off", so that is
      // held rather than written back as an invalid value.
      onValueChange={(e) => onChange((e.value as PeriodGrain | null) ?? value)}
      disabled={disabled}
      // A radiogroup with no visible label — the segments name themselves, but the group does not, so
      // it is named here rather than left as "radiogroup" to a screen reader.
      aria-label={t("periodGrain.label")}
      data-testid={testId}
    >
      <SegmentGroup.Indicator />
      {grains.map((grain) => (
        <SegmentGroup.Item key={grain} value={grain} data-testid={`${testId}-${grain}`}>
          <SegmentGroup.ItemText>{t(`periodGrain.${grain}`)}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
      ))}
    </SegmentGroup.Root>
  );
}
