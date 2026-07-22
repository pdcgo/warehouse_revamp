import { useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Icon,
  IconButton,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../api/clients";
import type { Team } from "../../gen/warehouse/team/v1/team_pb";
import { toaster } from "../../components/Toaster";
import { useUpdateTeam } from "./queries";

// EditTeamDialog changes only name + description. `type` and `team_code` are immutable after
// create — they are not in the request, so a rename can never violate the root-team invariant.
export function EditTeamDialog({
  team,
  open: openProp,
  onOpenChange,
}: {
  team: Team;
  /**
   * Optional controlled mode: when opened from a row's actions menu the page owns `open` and no
   * inline trigger is rendered. Absent, the dialog triggers itself as before.
   *
   * LIFECYCLE ONLY. It used to be joined by an `onDone` that existed purely so the caller could
   * refetch (#177); the write now invalidates the team cache itself, so the parent is told the
   * dialog closed and nothing more — which is what clears its `dialog`/`editing` state.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;

  const save = useUpdateTeam();
  const busy = save.isPending;

  function setOpen(next: boolean) {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
    }
  }

  const [error, setError] = useState("");

  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description);

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    // Fields are optional (presence): sending both is fine here since the form holds the current
    // values, and the backend never blanks what it does not receive.
    save.mutate(
      { teamId: team.id, name, description },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("teams.teamUpdated", { name }) });
          // The dialog is gone. NOT a refetch signal — the hook invalidated before this ran.
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      {!isControlled && (
        <Dialog.Trigger asChild>
          <IconButton size="xs" variant="ghost" aria-label="Edit" data-testid={`edit-team-${team.teamCode}`}>
            <Icon as={Pencil} boxSize="4" />
          </IconButton>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("teams.editTeamTitle", { name: team.name })}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="edit-team-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root>
                    <Field.Label>{t("teams.name")}</Field.Label>
                    <Input value={name} data-testid="edit-team-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("teams.description")}</Field.Label>
                    <Input
                      value={description}
                      data-testid="edit-team-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>

                  <Text fontSize="xs" color="fg.muted">
                    {t("teams.typeCodeFixed", { code: team.teamCode })}
                  </Text>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("teams.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-edit-team">
                  {t("teams.save")}
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
