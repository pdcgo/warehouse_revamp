import { useState } from "react";
import type { FormEvent } from "react";
import { Alert, Button, Card, Heading, Spinner, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";
import { ClosuresEditor } from "../../../features/warehouse/ClosuresEditor";
import { hoursAreSet } from "../../../features/warehouse/hours";
import { useSaveWarehouseProfile, useWarehouseInfo } from "../../../features/warehouse/queries";
import { WarehouseLocationField } from "../../../features/warehouse/WarehouseLocationField";
import { WeeklyHoursEditor, dayHoursFromWeek, weekFromDayHours } from "../../../features/warehouse/WeeklyHoursEditor";
import type { WeekHours } from "../../../features/warehouse/WeeklyHoursEditor";
import { useSeedOnce } from "../../../lib/useSeedOnce";

// THE WAREHOUSE SETS ITS OWN HOURS (the-warehouse-sets-its-own-hours-in-settings) — its receiving hours, its operating
// hours, its location and its closures, on its own Settings, for its Owner and Admin (the page mounts this only for a
// role WarehouseInfoUpdate takes — lib/roles.ts `editsWarehouseProfile`). The editors are the ones root's Teams → Edit
// warehouse uses (features/warehouse/), and both pages save the same profile.
//
// While the receiving hours are NOT SET — no profile, or a week that opens on no day — the card says so first: the
// order form shows no closed warning for a warehouse with no hours (a-warehouse-with-no-hours-is-not-closed), so the
// prompt is how its owner learns there is something to set. It reads the SAVED profile, never the fields being typed:
// a save re-reads the profile (useSaveWarehouseProfile), and the prompt goes once the hours are stored.
//
// ONE read of the profile (WarehouseInfoDetail, the shared `useWarehouseInfo` entry) feeds the form, the prompt and the
// closures list. The form is seeded ONCE (useSeedOnce): a closure added below, or this card's own save, re-reads the
// profile, and that answer never overwrites what somebody is typing.
export function WarehouseHoursCard({ teamId }: { teamId: bigint }) {
  const { t } = useTranslation();
  const info = useWarehouseInfo({ warehouseId: teamId });
  const save = useSaveWarehouseProfile();

  const [location, setLocation] = useState("");
  const [operating, setOperating] = useState<WeekHours>(weekFromDayHours(undefined));
  const [receiving, setReceiving] = useState<WeekHours>(weekFromDayHours(undefined));
  const [error, setError] = useState("");

  const seeded = useSeedOnce(teamId.toString(), info.isFetchedAfterMount, () => {
    if (info.isError) {
      setError(rpcError(info.error));
      return;
    }

    setLocation(info.data?.location ?? "");
    setOperating(weekFromDayHours(info.data?.operatingHours));
    setReceiving(weekFromDayHours(info.data?.receivingHours));
  });

  const notSet = info.isSuccess && !hoursAreSet(info.data?.receivingHours);

  async function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    try {
      await save.mutateAsync({
        teamId,
        operatingHours: dayHoursFromWeek(operating),
        receivingHours: dayHoursFromWeek(receiving),
        location,
      });

      toaster.create({ type: "success", title: t("account.warehouseHours.saved") });
    } catch (err) {
      setError(rpcError(err));
    }
  }

  return (
    <>
      <Card.Root data-testid="settings-warehouse-hours">
        <Card.Body>
          <form onSubmit={submit}>
            <Stack gap="card">
              <Heading size="sm">{t("account.warehouseHours.title")}</Heading>

              <Text color="fg.muted" fontSize="xs">
                {t("account.warehouseHours.hint")}
              </Text>

              {notSet && (
                <Alert.Root status="info" data-testid="settings-warehouse-hours-prompt">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{t("account.warehouseHours.promptTitle")}</Alert.Title>
                    <Alert.Description>{t("account.warehouseHours.promptBody")}</Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}

              {error && (
                <Text color="error.fg" fontSize="sm" data-testid="settings-warehouse-hours-error">
                  {error}
                </Text>
              )}

              {!seeded ? (
                <Spinner colorPalette="brand" data-testid="settings-warehouse-hours-loading" />
              ) : (
                <>
                  <WarehouseLocationField
                    value={location}
                    onChange={setLocation}
                    disabled={save.isPending}
                    testId="settings-warehouse-location"
                  />

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

                  <Button
                    type="submit"
                    colorPalette="brand"
                    loading={save.isPending}
                    data-testid="settings-warehouse-hours-save"
                  >
                    {t("account.save")}
                  </Button>
                </>
              )}
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>

      {/* One-off closures, each saved on its own — the very list Edit warehouse shows (a-warehouse-records-its-holidays),
          drawn from the same read of the profile. */}
      <ClosuresEditor warehouseId={teamId} closures={info.data?.closures ?? []} />
    </>
  );
}
