import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Flex, Heading, Icon, SimpleGrid, Spacer, Stack, Table, Text } from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { teamClient } from "../../../api/clients";
import { Weekday } from "../../../gen/warehouse/team/v1/team_pb";
import type { DayHours, WarehouseInfo } from "../../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { isGlobalAdmin } from "../../../lib/roles";
import { DetailField } from "./TeamDetailCommon";

const WEEKDAYS: { day: Weekday; labelKey: string }[] = [
  { day: Weekday.MONDAY, labelKey: "teams.weekday.monday" },
  { day: Weekday.TUESDAY, labelKey: "teams.weekday.tuesday" },
  { day: Weekday.WEDNESDAY, labelKey: "teams.weekday.wednesday" },
  { day: Weekday.THURSDAY, labelKey: "teams.weekday.thursday" },
  { day: Weekday.FRIDAY, labelKey: "teams.weekday.friday" },
  { day: Weekday.SATURDAY, labelKey: "teams.weekday.saturday" },
  { day: Weekday.SUNDAY, labelKey: "teams.weekday.sunday" },
];

// A read-only weekly schedule: one row per weekday, "open–close" or "Closed".
function ScheduleTable({ title, hours, testId }: { title: string; hours: DayHours[]; testId: string }) {
  const { t } = useTranslation();
  const byDay = new Map(hours.map((h) => [h.weekday, h]));

  return (
    <Stack gap="1" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {title}
      </Text>
      <Table.Root size="sm" data-testid={testId}>
        <Table.Body>
          {WEEKDAYS.map(({ day, labelKey }) => {
            const h = byDay.get(day);
            const open = h?.open ?? false;

            return (
              <Table.Row key={day}>
                <Table.Cell py="1">{t(labelKey)}</Table.Cell>
                <Table.Cell py="1" textAlign="end" color={open ? "fg" : "fg.muted"}>
                  {open ? `${h?.openTime || "—"}–${h?.closeTime || "—"}` : t("teams.closed")}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Stack>
  );
}

// WarehouseInfoSection is the WAREHOUSE-only part of a team detail page (#79): the physical location
// and the two weekly schedules (operating + order-receiving), read-only, with a shortcut to the edit
// page. Hours + location come from WarehouseInfoDetail (#39).
export function WarehouseInfoSection({ teamId }: { teamId: bigint }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { current } = useTeam();
  const admin = isGlobalAdmin(current?.role);

  const [info, setInfo] = useState<WarehouseInfo | undefined>(undefined);

  useEffect(() => {
    let alive = true;

    teamClient
      .warehouseInfoDetail({ teamId })
      .then((res) => {
        if (alive) setInfo(res.info);
      })
      .catch(() => {
        if (alive) setInfo(undefined);
      });

    return () => {
      alive = false;
    };
  }, [teamId]);

  return (
    <Stack gap="card" data-testid="warehouse-detail-section">
      <Flex align="center" gap="card">
        <Heading size="sm">{t("teams.warehouse")}</Heading>
        <Spacer />
        {admin && (
          <Button
            size="xs"
            variant="outline"
            data-testid="warehouse-detail-edit"
            onClick={() => navigate(`/teams/${teamId}/edit`)}
          >
            <Icon as={Pencil} boxSize="4" />
            {t("teams.editWarehouse")}
          </Button>
        )}
      </Flex>

      <DetailField label={t("teams.location")} value={info?.location ?? ""} />

      <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
        <ScheduleTable title={t("teams.operatingHours")} hours={info?.operatingHours ?? []} testId="warehouse-detail-operating" />
        <ScheduleTable title={t("teams.receivingHours")} hours={info?.receivingHours ?? []} testId="warehouse-detail-receiving" />
      </SimpleGrid>
    </Stack>
  );
}
