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
import { rpcError, userClient } from "../api/clients";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { useTeam } from "../team/TeamContext";
import { PasswordInput } from "../components/PasswordInput";
import { RoleSelect } from "../components/RoleSelect";
import { toaster } from "../components/Toaster";
import { rolesFor } from "../lib/roles";

// CreateUserDialog calls CreateUser, which creates the account AND the team membership in ONE
// transaction. So there is no window where a user exists with no team.
export function CreateUserDialog({
  onDone,
  open: openProp,
  onOpenChange,
}: {
  onDone: () => void;
  // Optional controlled mode: a caller may drive `open` and suppress the inline trigger. Absent,
  // the dialog triggers itself as before.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { current } = useTeam();

  const roles = rolesFor(current?.teamType);

  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;
  const [busy, setBusy] = useState(false);

  function setOpen(next: boolean) {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
    }
  }

  const [error, setError] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(roles[roles.length - 1] ?? Role.TEAM_ADMIN);

  async function submit(event: FormEvent) {
    event.preventDefault();

    // Username is lowercase alphanumeric only (#87) — the backend enforces the same rule.
    if (!/^[a-z0-9]+$/.test(username)) {
      setError("Username may only contain lowercase letters and numbers.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      await userClient.createUser({
        // The CURRENT TEAM is the scope. It travels in the message body — the backend's
        // (use_scope) option reads it from there, not from a header.
        teamId: current?.teamId ?? 0n,
        username,
        password,
        name,
        email,
        role,
        alias: "",
      });

      toaster.create({ type: "success", title: `${username} created` });

      setUsername("");
      setPassword("");
      setName("");
      setEmail("");
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
      {!isControlled && (
        <Dialog.Trigger asChild>
          <Button size="xs" colorPalette="brand" data-testid="open-create-user">
            New user
          </Button>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>New User</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="create-user-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>Username</Field.Label>
                    <Input
                      value={username}
                      data-testid="new-username"
                      onChange={(e) => setUsername(e.target.value)}
                    />
                    <Field.HelperText>Lowercase letters and numbers only.</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>Password</Field.Label>
                    <PasswordInput
                      value={password}
                      data-testid="new-password"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <Field.HelperText>At least 8 characters.</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Name</Field.Label>
                    <Input value={name} data-testid="new-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Email</Field.Label>
                    <Input value={email} data-testid="new-email" onChange={(e) => setEmail(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Role in {current?.teamName || "this team"}</Field.Label>
                    <RoleSelect teamType={current?.teamType} value={role} onChange={setRole} />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-create-user">
                  Create
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
