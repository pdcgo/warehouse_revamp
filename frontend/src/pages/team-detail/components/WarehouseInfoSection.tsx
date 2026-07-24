import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/Button";
import { Table } from "../../../components/ui/Table";
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
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-medium uppercase text-fg-muted">{title}</p>
      <Table.Root data-testid={testId}>
        <Table.Body>
          {WEEKDAYS.map(({ day, labelKey }) => {
            const h = byDay.get(day);
            const open = h?.open ?? false;

            return (
              <Table.Row key={day}>
                <Table.Cell className="py-1">{t(labelKey)}</Table.Cell>
                <Table.Cell className={`py-1 text-right ${open ? "text-fg" : "text-fg-muted"}`}>
                  {open ? `${h?.openTime || "—"}–${h?.closeTime || "—"}` : t("teams.closed")}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </div>
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
    <div className="flex flex-col gap-card" data-testid="warehouse-detail-section">
      <div className="flex items-center gap-card">
        <h2 className="text-[15px] font-semibold">{t("teams.warehouse")}</h2>
        <div className="flex-1" />
        {admin && (
          <Button
            size="xs"
            variant="outline"
            data-testid="warehouse-detail-edit"
            onClick={() => navigate(`/teams/${teamId}/edit`)}
          >
            <Pencil className="size-4" />
            {t("teams.editWarehouse")}
          </Button>
        )}
      </div>

      <DetailField label={t("teams.location")} value={info?.location ?? ""} />

      <div className="grid grid-cols-1 gap-card md:grid-cols-2">
        <ScheduleTable title={t("teams.operatingHours")} hours={info?.operatingHours ?? []} testId="warehouse-detail-operating" />
        <ScheduleTable title={t("teams.receivingHours")} hours={info?.receivingHours ?? []} testId="warehouse-detail-receiving" />
      </div>
    </div>
  );
}
