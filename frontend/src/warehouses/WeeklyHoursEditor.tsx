import { Box, HStack, Input, Stack, Switch, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Weekday } from "../gen/warehouse/team/v1/team_pb";
import type { DayHours } from "../gen/warehouse/team/v1/team_pb";

// The seven weekdays in display order (Mon..Sun), matching the backend's Weekday 1..7.
const WEEKDAYS: { day: Weekday; labelKey: string }[] = [
  { day: Weekday.MONDAY, labelKey: "teams.weekday.monday" },
  { day: Weekday.TUESDAY, labelKey: "teams.weekday.tuesday" },
  { day: Weekday.WEDNESDAY, labelKey: "teams.weekday.wednesday" },
  { day: Weekday.THURSDAY, labelKey: "teams.weekday.thursday" },
  { day: Weekday.FRIDAY, labelKey: "teams.weekday.friday" },
  { day: Weekday.SATURDAY, labelKey: "teams.weekday.saturday" },
  { day: Weekday.SUNDAY, labelKey: "teams.weekday.sunday" },
];

export interface DayRow {
  open: boolean;
  openTime: string;
  closeTime: string;
}

// WeekHours is always length 7, aligned to WEEKDAYS order — so the editor is a fixed grid and a
// missing/closed day is still a row you can toggle on.
export type WeekHours = DayRow[];

// weekFromDayHours turns the sparse schedule the API returns into a full 7-row week. A day the
// API omits (never set, or closed) becomes a closed row with sensible default times to edit.
export function weekFromDayHours(rows: DayHours[] | undefined): WeekHours {
  return WEEKDAYS.map(({ day }) => {
    const found = rows?.find((r) => r.weekday === day);

    if (!found) {
      return { open: false, openTime: "09:00", closeTime: "17:00" };
    }

    return {
      open: found.open,
      openTime: found.openTime || "09:00",
      closeTime: found.closeTime || "17:00",
    };
  });
}

// dayHoursFromWeek converts the grid back to the request shape. A closed day sends blank times
// (the backend ignores times on a closed day), so toggling a day shut never fails validation.
export function dayHoursFromWeek(week: WeekHours) {
  return WEEKDAYS.map(({ day }, i) => ({
    weekday: day,
    open: week[i].open,
    openTime: week[i].open ? week[i].openTime : "",
    closeTime: week[i].open ? week[i].closeTime : "",
  }));
}

interface WeeklyHoursEditorProps {
  label: string;
  value: WeekHours;
  onChange: (week: WeekHours) => void;
  testId: string;
}

// WeeklyHoursEditor is a fixed 7-row grid: each weekday has an open/closed switch and, when open,
// an open and a close time. Used twice on the warehouse edit page (operating + receiving hours).
export function WeeklyHoursEditor({ label, value, onChange, testId }: WeeklyHoursEditorProps) {
  const { t } = useTranslation();

  function setRow(index: number, patch: Partial<DayRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <Stack gap="card" data-testid={testId}>
      <Text fontSize="sm" fontWeight="semibold">
        {label}
      </Text>

      {WEEKDAYS.map((wd, i) => {
        const row = value[i];

        return (
          <HStack key={wd.day} gap="card" align="center">
            <Box w="90px" fontSize="sm">
              {t(wd.labelKey)}
            </Box>

            <Switch.Root
              checked={row.open}
              onCheckedChange={(e) => setRow(i, { open: !!e.checked })}
              data-testid={`${testId}-open-${wd.day}`}
            >
              <Switch.HiddenInput />
              <Switch.Control />
              <Switch.Label>{row.open ? t("teams.open") : t("teams.closed")}</Switch.Label>
            </Switch.Root>

            {row.open && (
              <HStack gap="2">
                <Input
                  type="time"
                  size="xs"
                  w="110px"
                  value={row.openTime}
                  data-testid={`${testId}-from-${wd.day}`}
                  onChange={(e) => setRow(i, { openTime: e.target.value })}
                />
                <Text fontSize="xs" color="fg.muted">
                  {t("teams.to")}
                </Text>
                <Input
                  type="time"
                  size="xs"
                  w="110px"
                  value={row.closeTime}
                  data-testid={`${testId}-to-${wd.day}`}
                  onChange={(e) => setRow(i, { closeTime: e.target.value })}
                />
              </HStack>
            )}
          </HStack>
        );
      })}
    </Stack>
  );
}
