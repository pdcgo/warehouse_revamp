import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Flex, Heading, Icon, SimpleGrid, Spacer, Stack, Table, Text } from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { teamClient } from "../api/clients";
import { Weekday } from "../gen/warehouse/team/v1/team_pb";
import type { DayHours, WarehouseInfo } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { isGlobalAdmin } from "../lib/roles";
import { DetailField } from "./TeamDetailCommon";

const WEEKDAYS: { day: Weekday; label: string }[] = [
  { day: Weekday.MONDAY, label: "Monday" },
  { day: Weekday.TUESDAY, label: "Tuesday" },
  { day: Weekday.WEDNESDAY, label: "Wednesday" },
  { day: Weekday.THURSDAY, label: "Thursday" },
  { day: Weekday.FRIDAY, label: "Friday" },
  { day: Weekday.SATURDAY, label: "Saturday" },
  { day: Weekday.SUNDAY, label: "Sunday" },
];

// A read-only weekly schedule: one row per weekday, "open–close" or "Closed".
function ScheduleTable({ title, hours, testId }: { title: string; hours: DayHours[]; testId: string }) {
  const byDay = new Map(hours.map((h) => [h.weekday, h]));

  return (
    <Stack gap="1" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {title}
      </Text>
      <Table.Root size="sm" data-testid={testId}>
        <Table.Body>
          {WEEKDAYS.map(({ day, label }) => {
            const h = byDay.get(day);
            const open = h?.open ?? false;

            return (
              <Table.Row key={day}>
                <Table.Cell py="1">{label}</Table.Cell>
                <Table.Cell py="1" textAlign="end" color={open ? "fg" : "fg.muted"}>
                  {open ? `${h?.openTime || "—"}–${h?.closeTime || "—"}` : "Closed"}
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
        <Heading size="sm">Warehouse</Heading>
        <Spacer />
        {admin && (
          <Button
            size="xs"
            variant="outline"
            data-testid="warehouse-detail-edit"
            onClick={() => navigate(`/teams/${teamId}/edit`)}
          >
            <Icon as={Pencil} boxSize="4" />
            Edit warehouse
          </Button>
        )}
      </Flex>

      <DetailField label="Location" value={info?.location ?? ""} />

      <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
        <ScheduleTable title="Operating hours" hours={info?.operatingHours ?? []} testId="warehouse-detail-operating" />
        <ScheduleTable title="Order-receiving hours" hours={info?.receivingHours ?? []} testId="warehouse-detail-receiving" />
      </SimpleGrid>
    </Stack>
  );
}
