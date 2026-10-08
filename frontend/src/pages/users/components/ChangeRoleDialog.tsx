import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Portal, Stack, Text } from "@chakra-ui/react";
import { rpcError } from "../../../api/clients";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import type { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import type { User } from "../../../gen/warehouse/user/v1/user_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { useChangeMemberRole } from "../../../features/users/queries";
import { RoleSelect } from "../../../components/pickers/RoleSelect";
import { toaster } from "../../../components/feedback/Toaster";
import { grantableRoles, roleLabel } from "../../../lib/roles";

// ChangeRoleDialog — a member's role, changed from the member list (an-existing-member-gets-change-role).
//
// It offers only what the caller may give (change-role-only-below-your-own), minus the role the person
// already holds — choosing it again would be a write that changes nothing. The row only opens this
// for someone whose role is below the caller's; the server is the boundary once it is built.
export function ChangeRoleDialog({
  user,
  teamId,
  teamType,
  currentRole,
  onOpenChange,
}: {
  user: User;
  teamId: bigint;
  teamType: TeamType | undefined;
  currentRole: Role | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { current } = useTeam();

  const roles = grantableRoles(teamType, current?.role).filter((r) => r !== currentRole);
  const [role, setRole] = useState<Role>(roles[0] ?? Role.UNSPECIFIED);
  const [error, setError] = useState("");

  const save = useChangeMemberRole();

  function submit() {
    if (role === Role.UNSPECIFIED) return;

    setError("");
    save.mutate(
      { teamId, userId: user.id, role },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("users.toast.roleChanged", { username: user.username, role: roleLabel(role, teamType) }),
          });
          onOpenChange(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open onOpenChange={(e) => onOpenChange(e.open)}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="change-role-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("users.changeRole.title", { username: user.username })}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                {error && (
                  <Text color="error.fg" data-testid="change-role-error">
                    {error}
                  </Text>
                )}

                <Text textStyle="sm" data-testid="change-role-current">
                  {t("users.changeRole.current", { role: roleLabel(currentRole, teamType) })}
                </Text>

                <Field.Root>
                  <Field.Label>{t("users.changeRole.newRole")}</Field.Label>
                  <RoleSelect roles={roles} teamType={teamType} value={role} onChange={setRole} />
                  <Field.HelperText>{t("users.changeRole.helper")}</Field.HelperText>
                </Field.Root>
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">{t("users.cancel")}</Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="brand"
                loading={save.isPending}
                disabled={role === Role.UNSPECIFIED}
                onClick={submit}
                data-testid="submit-change-role"
              >
                {t("users.changeRole.submit")}
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
