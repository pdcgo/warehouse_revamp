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
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { toaster } from "../../components/feedback/Toaster";
import { canWrite, useTeam } from "../team/TeamContext";
import { useUpdateTeam } from "./queries";
import { editsTeamCode, TEAM_CODE_MAX, useTeamCodeChange } from "./teamCode";
import { TeamCodeConfirm } from "./TeamCodeConfirm";

// EditTeamDialog changes the name + description — and, for a SELLING team, its code (backlog #150,
// the-team-code-and-product-tags-prototype-is-accepted, *Teams → Edit Team (root)*). `type` stays immutable after create;
// it is not in any request, so a rename can never violate the root-team invariant.
//
// THE CODE goes through its OWN write (TeamCodeUpdate, whose policy is narrower than TeamUpdate's and which recomposes the
// team's products), after the same ask and confirm Settings' *Kode tim* card has (features/teams/teamCode.ts). An
// UNTOUCHED code is never sent — Save then saves the name and description exactly as before. A changed one is asked
// first: refused in place when another team holds it or held it once, else the four-line confirm, then the code, then
// the name and description. A warehouse's or an admin team's code stays fixed — its dialog keeps the "fixed" line.
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
  const { current, platformRole } = useTeam();
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;

  const save = useUpdateTeam();

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

  // THE CODE FIELD — a SELLING team's, for whoever may change it: Root and the Administrator (their reach is the root
  // team's), or the team's own Owner and Admin (TeamCodeUpdate's policy; UX only, the interceptor is the boundary).
  const codeEditable =
    team.type === TeamType.SELLING &&
    canWrite(current) &&
    (platformRole !== undefined || (current?.teamId === team.id && editsTeamCode(current.role)));
  const [code, setCode] = useState(team.teamCode);
  const newCode = code.trim();
  const codeChanged = codeEditable && newCode !== team.teamCode;
  const codeTooLong = [...newCode].length > TEAM_CODE_MAX;
  const change = useTeamCodeChange(team.id);
  const refused = change.refusal;
  const busy = save.isPending || change.asking || change.saving;

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    // An untouched code is never sent: the name and description save as they always did.
    if (!codeChanged) {
      saveDetails();
      return;
    }

    if (newCode === "" || codeTooLong) return;

    void change.ask(newCode);
  }

  // The code first — refused, nothing else is saved — then the name and description as before.
  async function saveCode() {
    const answer = await change.confirm();
    if (!answer) return;

    saveDetails();
  }

  function saveDetails() {
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
                    <Text color="error.fg" data-testid="edit-team-error">
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

                  {codeEditable ? (
                    <>
                      <Field.Root invalid={refused !== null || codeTooLong || change.error !== ""}>
                        <Field.Label>{t("teams.teamCode")}</Field.Label>
                        <Input
                          value={code}
                          fontFamily="mono"
                          maxW="16rem"
                          disabled={busy}
                          data-testid="edit-team-code"
                          onChange={(e) => {
                            setCode(e.target.value);
                            change.clear();
                          }}
                        />
                        {refused ? (
                          <Field.ErrorText data-testid="edit-team-code-refused">
                            {refused.why === "taken"
                              ? t("account.teamCode.taken", { code: refused.code, team: refused.holder })
                              : t("account.teamCode.former", { code: refused.code })}
                          </Field.ErrorText>
                        ) : change.error ? (
                          <Field.ErrorText data-testid="edit-team-code-error">{change.error}</Field.ErrorText>
                        ) : codeTooLong ? (
                          <Field.ErrorText data-testid="edit-team-code-too-long">
                            {t("account.teamCode.tooLong", { max: TEAM_CODE_MAX })}
                          </Field.ErrorText>
                        ) : (
                          <Field.HelperText data-testid="edit-team-code-help">{t("teams.codeEdit.help")}</Field.HelperText>
                        )}
                      </Field.Root>

                      <Text fontSize="xs" color="fg.muted" data-testid="edit-team-type-fixed">
                        {t("teams.codeEdit.typeFixed")}
                      </Text>
                    </>
                  ) : (
                    <Text fontSize="xs" color="fg.muted">
                      {t("teams.typeCodeFixed", { code: team.teamCode })}
                    </Text>
                  )}
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

            {change.confirming && (
              <TeamCodeConfirm
                open
                onOpenChange={(next) => {
                  if (!next) change.closeConfirm();
                }}
                oldTeamCode={team.teamCode}
                newTeamCode={change.confirming.code}
                figures={change.confirming.figures}
                onConfirm={saveCode}
              />
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
