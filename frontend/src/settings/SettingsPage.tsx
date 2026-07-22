import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Field, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../api/clients";
import { useTeam } from "../team/TeamContext";
import { useUpdateTeam, useSaveTeamInfo, useTeamDetail } from "../teams/queries";
import { TeamPicture } from "../team/TeamPicture";
import { toaster } from "../components/Toaster";
import { isTeamManager } from "../lib/roles";
import { TeamSelect } from "../components/TeamSelect";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";

// SettingsPage (#44) lets a team manager change the CURRENT team's picture and name.
//
// Everything here is SCOPED to the current team — team_id rides in each request body (the backend
// (use_scope) reads it there, never a header). The manager gate below is UX only; the access
// interceptor is the real boundary.
export function SettingsPage() {
  const { t } = useTranslation();
  const { current, refresh } = useTeam();
  const updateTeam = useUpdateTeam();
  const saveTeamInfo = useSaveTeamInfo();

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // The warehouse this SELLING team ships from by default (#145). 0 = not configured.
  const [defaultWarehouse, setDefaultWarehouse] = useState<bigint>(0n);

  const canEdit = isTeamManager(current?.role);

  // Keep the name field in sync with whichever team is current.
  useEffect(() => {
    setName(current?.teamName ?? "");
  }, [current?.teamId, current?.teamName]);

  // The default warehouse lives on the team INFO, which the switcher does not carry — so it is read
  // here, per team.
  const teamId = current?.teamId;

  // Read through the same hook the team detail page and the contact dialog use, so a save from any
  // of them moves all three.
  const detail = useTeamDetail({ teamId: teamId ?? 0n, enabled: teamId !== undefined });
  const savedWarehouse = detail.data?.info?.defaultWarehouseId;

  // Seed the picker from the server, and RE-seed when the team changes. Keyed on the saved value
  // rather than the whole record: a refetch that returns an identical setting must not yank the
  // picker back while somebody is choosing a different one.
  useEffect(() => {
    setDefaultWarehouse(savedWarehouse ?? 0n);
  }, [savedWarehouse, teamId]);

  if (!current) {
    return (
      <Stack gap="section" maxW="lg">
        <Heading size="md">{t("account.settings")}</Heading>
        <Text color="fg.muted" data-testid="settings-no-team">
          {t("account.selectTeamToManage")}
        </Text>
      </Stack>
    );
  }

  async function saveDefaultWarehouse(event: FormEvent) {
    event.preventDefault();

    if (!current) return;

    setBusy(true);

    try {
      await saveTeamInfo.mutateAsync({
        teamId: current.teamId,
        // Sent explicitly, including 0: the field is `optional` on the wire, and a present zero is
        // how the contract says "clear it" (#145). Omitting it would mean "leave alone", so somebody
        // who cleared the picker would find their old default still there.
        //
        // The bank and contact fields are OMITTED for the mirror-image reason — absent leaves them
        // alone, and sending them empty here would wipe details this screen never showed.
        defaultWarehouseId: defaultWarehouse,
      });

      toaster.create({ type: "success", title: t("account.defaultWarehouseSaved") });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();

    if (!current) {
      return;
    }

    setBusy(true);

    try {
      // Only the name. `description` is omitted rather than sent empty — absent means leave alone,
      // and this screen has no description field to have gathered one from.
      await updateTeam.mutateAsync({ teamId: current.teamId, name });

      // Reflect the rename in the team switcher and everywhere else `current` is read.
      await refresh();

      toaster.create({ type: "success", title: t("account.teamNameUpdated") });
    } catch (err) {
      toaster.create({ type: "error", title: t("account.updateFailed"), description: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="section" maxW="lg">
      <Heading size="md">{t("account.settings")}</Heading>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Heading size="sm">{t("account.teamPicture")}</Heading>
            <TeamPicture />
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <form onSubmit={saveName}>
            <Stack gap="card">
              <Heading size="sm">{t("account.teamName")}</Heading>

              <Field.Root>
                <Field.Label>{t("account.name")}</Field.Label>
                <Input
                  value={name}
                  disabled={!canEdit || busy}
                  data-testid="settings-team-name"
                  onChange={(e) => setName(e.target.value)}
                />
              </Field.Root>

              {!canEdit && (
                <Text color="fg.muted" fontSize="xs" data-testid="settings-name-hint">
                  {t("account.onlyOwnerCanRename")}
                </Text>
              )}

              <Button
                type="submit"
                colorPalette="brand"
                loading={busy}
                disabled={!canEdit}
                data-testid="save-team-name"
              >
                {t("account.save")}
              </Button>
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>

      {/* The default shipping warehouse (#145) — a SELLING team's setting only. A warehouse does not
          ship from a warehouse, so the card is absent rather than disabled for one. */}
      {current.teamType === TeamType.SELLING && (
        <Card.Root>
          <Card.Body>
            <form onSubmit={saveDefaultWarehouse}>
              <Stack gap="card">
                <Heading size="sm">{t("account.defaultWarehouse")}</Heading>

                <Text color="fg.muted" fontSize="xs">
                  {t("account.defaultWarehouseHint")}
                </Text>

                <Field.Root>
                  <Field.Label>{t("account.warehouse")}</Field.Label>
                  <TeamSelect
                    value={defaultWarehouse === 0n ? undefined : defaultWarehouse}
                    teamType={TeamType.WAREHOUSE}
                    disabled={!canEdit || busy}
                    onChange={setDefaultWarehouse}
                  />
                </Field.Root>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!canEdit}
                  data-testid="save-default-warehouse"
                >
                  {t("account.save")}
                </Button>
              </Stack>
            </form>
          </Card.Body>
        </Card.Root>
      )}
    </Stack>
  );
}
