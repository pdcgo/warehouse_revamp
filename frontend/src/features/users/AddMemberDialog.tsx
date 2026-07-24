import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Portal, Stack, Text } from "@chakra-ui/react";
import { rpcError } from "../../api/clients";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import type { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { toaster } from "../../components/Toaster";
import { RoleSelect } from "../../components/RoleSelect";
import { UserSelect } from "../../components/UserSelect";
import { rolesFor } from "../../lib/roles";
import { useAddTeamMember } from "./queries";

// AddMemberDialog adds an EXISTING user to a team. It defaults to the CURRENT team (the scope), but
// a caller may target another team explicitly (the team detail page manages an arbitrary team's
// members) by passing `teamId` + `teamType`.
//
// Both pickers are the shared components (#62): UserSelect (unscoped — you are looking for someone
// NOT in the team yet) and RoleSelect (scoped to the target team type's assignable roles).
export function AddMemberDialog({
  teamId,
  teamType,
}: {
  teamId?: bigint;
  teamType?: TeamType;
}) {
  const { t } = useTranslation();
  const { current } = useTeam();

  const targetTeamId = teamId ?? current?.teamId;
  const targetTeamType = teamType ?? current?.teamType;

  const roles = rolesFor(targetTeamType);

  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<bigint | undefined>(undefined);
  const [role, setRole] = useState<Role>(roles[roles.length - 1] ?? Role.TEAM_ADMIN);
  const [error, setError] = useState("");

  // The membership write, and what it invalidates, declared together in queries.ts (#177). This
  // dialog is opened from TWO places — the Users page header and a team's detail page — which is
  // exactly the case the old `onDone` prop got wrong: whether the list behind it refreshed depended
  // on which caller had remembered to wire the callback.
  const save = useAddTeamMember();
  const busy = save.isPending;

  function add() {
    if (userId === undefined || targetTeamId === undefined) {
      return;
    }

    setError("");

    save.mutate(
      { teamId: targetTeamId, userId, role },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("users.toast.memberAdded") });

          setUserId(undefined);
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) {
          setUserId(undefined);
          setError("");
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button size="xs" variant="outline" data-testid="open-add-member">
          {t("users.addMember.trigger")}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{t("users.addMember.title")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                {error && (
                  <Text color="red.fg" data-testid="add-member-error">
                    {error}
                  </Text>
                )}

                <Field.Root>
                  <Field.Label>{t("users.addMember.findUser")}</Field.Label>
                  <UserSelect value={userId} onChange={setUserId} placeholder={t("users.addMember.searchPlaceholder")} />
                  <Field.HelperText>{t("users.addMember.helper")}</Field.HelperText>
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("users.field.role")}</Field.Label>
                  <RoleSelect teamType={targetTeamType} value={role} onChange={setRole} />
                </Field.Root>
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button type="button" variant="outline">
                  {t("users.cancel")}
                </Button>
              </Dialog.ActionTrigger>

              <Button
                colorPalette="brand"
                loading={busy}
                disabled={userId === undefined}
                onClick={add}
                data-testid="submit-add-member"
              >
                {t("users.addMember.submit")}
              </Button>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
