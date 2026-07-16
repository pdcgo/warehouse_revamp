import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Field, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError, teamClient } from "../api/clients";
import { useTeam } from "../team/TeamContext";
import { TeamPicture } from "../team/TeamPicture";
import { toaster } from "../components/Toaster";
import { isTeamManager } from "../lib/roles";

// SettingsPage (#44) lets a team manager change the CURRENT team's picture and name.
//
// Everything here is SCOPED to the current team — team_id rides in each request body (the backend
// (use_scope) reads it there, never a header). The manager gate below is UX only; the access
// interceptor is the real boundary.
export function SettingsPage() {
  const { t } = useTranslation();
  const { current, refresh } = useTeam();

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const canEdit = isTeamManager(current?.role);

  // Keep the name field in sync with whichever team is current.
  useEffect(() => {
    setName(current?.teamName ?? "");
  }, [current?.teamId, current?.teamName]);

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

  async function saveName(event: FormEvent) {
    event.preventDefault();

    if (!current) {
      return;
    }

    setBusy(true);

    try {
      await teamClient.teamUpdate({ teamId: current.teamId, name });

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
    </Stack>
  );
}
