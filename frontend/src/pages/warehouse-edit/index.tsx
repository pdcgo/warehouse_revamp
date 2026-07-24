import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError, teamClient } from "../../api/clients";
import { toaster } from "../../components/Toaster";
import { Button, IconButton } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { Spinner } from "../../components/ui/Spinner";
import { useSaveWarehouse } from "./queries";
import { WeeklyHoursEditor, dayHoursFromWeek, weekFromDayHours } from "./components/WeeklyHoursEditor";
import type { WeekHours } from "./components/WeeklyHoursEditor";

// WarehouseEditPage is the warehouse edit surface as a DEDICATED PAGE (issue #39 comment 6 — not
// a popup). It edits the warehouse's name and description AND its two weekly schedules: general
// operating hours and when it can receive orders.
export function WarehouseEditPage() {
  const { t } = useTranslation();
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();

  const id = teamId ? BigInt(teamId) : 0n;

  const [loading, setLoading] = useState(true);
  // The write, and the team-list invalidation it owes, declared together (#177).
  const saveWarehouse = useSaveWarehouse();
  const saving = saveWarehouse.isPending;
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [operating, setOperating] = useState<WeekHours>(weekFromDayHours(undefined));
  const [receiving, setReceiving] = useState<WeekHours>(weekFromDayHours(undefined));

  useEffect(() => {
    if (id === 0n) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        // Team basics and warehouse hours come from two RPCs; load them together.
        const [detail, hours] = await Promise.all([
          teamClient.teamDetail({ teamId: id }),
          teamClient.warehouseInfoDetail({ teamId: id }),
        ]);

        if (cancelled) {
          return;
        }

        setName(detail.team?.name ?? "");
        setDescription(detail.team?.description ?? "");
        setLocation(hours.info?.location ?? "");
        setOperating(weekFromDayHours(hours.info?.operatingHours));
        setReceiving(weekFromDayHours(hours.info?.receivingHours));
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault();

    setError("");

    try {
      // A warehouse is a TEAM, so this write stales the team list — the hook invalidates it (#177).
      // Without that the rename is invisible on the Teams page for the whole 30s staleTime.
      await saveWarehouse.mutateAsync({
        teamId: id,
        name,
        description,
        operatingHours: dayHoursFromWeek(operating),
        receivingHours: dayHoursFromWeek(receiving),
        location,
      });

      toaster.create({ type: "success", title: t("teams.warehouseSaved") });
      void navigate(`/teams/${teamId}`);
    } catch (err) {
      setError(rpcError(err));
    }
  }

  if (loading) {
    return <Spinner />;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-section" data-testid="warehouse-edit-page">
      <div className="flex items-center gap-card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back"
          data-testid="warehouse-edit-back"
          onClick={() => navigate(`/teams/${teamId}`)}
        >
          <ArrowLeft className="size-4" />
        </IconButton>
        <h1 className="text-[22px] font-bold">{t("teams.editWarehouseTitle")}</h1>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="warehouse-edit-error">
          {error}
        </p>
      )}

      <form onSubmit={save}>
        <div className="flex flex-col gap-section">
          <Card>
            <CardBody>
              <div className="flex flex-col gap-card">
                <Field.Root required>
                  <Field.Label>{t("teams.name")}</Field.Label>
                  <Field.Input
                    value={name}
                    data-testid="warehouse-edit-name"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("teams.description")}</Field.Label>
                  <Field.Textarea
                    value={description}
                    data-testid="warehouse-edit-description"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("teams.location")}</Field.Label>
                  <Field.Textarea
                    value={location}
                    data-testid="warehouse-edit-location"
                    onChange={(e) => setLocation(e.target.value)}
                  />
                  <Field.HelperText>{t("teams.warehouseAddressHelp")}</Field.HelperText>
                </Field.Root>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div className="flex flex-col gap-section">
                <WeeklyHoursEditor
                  label={t("teams.operatingHours")}
                  value={operating}
                  onChange={setOperating}
                  testId="operating-hours"
                />

                <WeeklyHoursEditor
                  label={t("teams.receivingHours")}
                  value={receiving}
                  onChange={setReceiving}
                  testId="receiving-hours"
                />
              </div>
            </CardBody>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" colorPalette="brand" loading={saving} data-testid="warehouse-edit-save">
              {t("teams.save")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
