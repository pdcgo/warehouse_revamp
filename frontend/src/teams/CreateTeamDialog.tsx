import { useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError, teamClient } from "../api/clients";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { toaster } from "../components/Toaster";
import { TeamTypeSelect, teamTypeLabel } from "../components/TeamTypeSelect";

export function CreateTeamDialog({
  onDone,
  fixedType,
}: {
  onDone: () => void;
  // When set, the new team is always this type: the type selector is hidden and shown as
  // read-only text. Used by warehouse-scoped views that only ever create WAREHOUSE teams.
  fixedType?: TeamType;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [type, setType] = useState<TeamType>(fixedType ?? TeamType.WAREHOUSE);

  // Label for the locked type (falls back to a generic noun for an unset fixedType).
  const lockedLabel = fixedType !== undefined ? teamTypeLabel(fixedType) : "Team";
  const [name, setName] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [description, setDescription] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      // TeamCreate also grants the caller ownership of the new team, server-side, via a
      // compensating RPC — so a fresh team is never ownerless.
      await teamClient.teamCreate({ type, name, teamCode, description });

      toaster.create({ type: "success", title: t("teams.teamCreated", { name }) });

      setName("");
      setTeamCode("");
      setDescription("");
      setOpen(false);
      onDone();
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Dialog.Trigger asChild>
        <Button
          size="xs"
          colorPalette="brand"
          data-testid={fixedType === undefined ? "open-create-team" : `open-create-${lockedLabel.toLowerCase()}`}
        >
          {fixedType === undefined ? t("teams.newTeam") : t("teams.newLabeled", { label: lockedLabel.toLowerCase() })}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>
                  {fixedType === undefined ? t("teams.newTeamTitle") : t("teams.newLabeled", { label: lockedLabel })}
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="create-team-error">
                      {error}
                    </Text>
                  )}

                  {fixedType === undefined ? (
                    <Field.Root required>
                      <Field.Label>{t("teams.type")}</Field.Label>
                      <TeamTypeSelect value={type} onChange={setType} />
                      <Field.HelperText>{t("teams.typeFixedHelp")}</Field.HelperText>
                    </Field.Root>
                  ) : (
                    <Field.Root>
                      <Field.Label>{t("teams.type")}</Field.Label>
                      <Text fontWeight="medium" data-testid="new-team-type-fixed">
                        {lockedLabel}
                      </Text>
                      <Field.HelperText>{t("teams.lockedForView")}</Field.HelperText>
                    </Field.Root>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("teams.name")}</Field.Label>
                    <Input
                      value={name}
                      data-testid="new-team-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Field.HelperText>{t("teams.nameHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("teams.teamCode")}</Field.Label>
                    <Input
                      value={teamCode}
                      data-testid="new-team-code"
                      onChange={(e) => setTeamCode(e.target.value)}
                    />
                    <Field.HelperText>{t("teams.teamCodeHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("teams.description")}</Field.Label>
                    <Input
                      value={description}
                      data-testid="new-team-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("teams.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-create-team">
                  {t("teams.create")}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
