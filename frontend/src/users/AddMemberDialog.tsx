import { useState } from "react";
import { Button, CloseButton, Dialog, Field, Portal, Stack, Text } from "@chakra-ui/react";
import { rpcError, userClient } from "../api/clients";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import type { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { toaster } from "../components/Toaster";
import { RoleSelect } from "../components/RoleSelect";
import { UserSelect } from "../components/UserSelect";
import { rolesFor } from "../lib/roles";

// AddMemberDialog adds an EXISTING user to a team. It defaults to the CURRENT team (the scope), but
// a caller may target another team explicitly (the team detail page manages an arbitrary team's
// members) by passing `teamId` + `teamType`.
//
// Both pickers are the shared components (#62): UserSelect (unscoped — you are looking for someone
// NOT in the team yet) and RoleSelect (scoped to the target team type's assignable roles).
export function AddMemberDialog({
  onDone,
  teamId,
  teamType,
}: {
  onDone: () => void;
  teamId?: bigint;
  teamType?: TeamType;
}) {
  const { current } = useTeam();

  const targetTeamId = teamId ?? current?.teamId;
  const targetTeamType = teamType ?? current?.teamType;

  const roles = rolesFor(targetTeamType);

  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<bigint | undefined>(undefined);
  const [role, setRole] = useState<Role>(roles[roles.length - 1] ?? Role.TEAM_ADMIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    if (userId === undefined || targetTeamId === undefined) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await userClient.teamUserUpdate({
        teamId: targetTeamId,
        action: {
          case: "add",
          value: { userId, role, alias: "" },
        },
      });

      toaster.create({ type: "success", title: "Member added" });

      setUserId(undefined);
      setOpen(false);
      onDone();
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setBusy(false);
    }
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
          Add member
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Add Member</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                {error && (
                  <Text color="red.fg" data-testid="add-member-error">
                    {error}
                  </Text>
                )}

                <Field.Root>
                  <Field.Label>Find a user</Field.Label>
                  <UserSelect value={userId} onChange={setUserId} placeholder="Search across all teams" />
                  <Field.HelperText>Searches everyone — add a user who isn't in this team yet.</Field.HelperText>
                </Field.Root>

                <Field.Root>
                  <Field.Label>Role</Field.Label>
                  <RoleSelect teamType={targetTeamType} value={role} onChange={setRole} />
                </Field.Root>
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.ActionTrigger>

              <Button
                colorPalette="brand"
                loading={busy}
                disabled={userId === undefined}
                onClick={() => void add()}
                data-testid="submit-add-member"
              >
                Add
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
