import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
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
import { rpcError } from "../../../api/clients";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { PasswordInput } from "../../../components/PasswordInput";
import { RoleSelect } from "../../../components/RoleSelect";
import { toaster } from "../../../components/Toaster";
import { rolesFor } from "../../../lib/roles";
import { useCreateUser } from "../../../features/users/queries";

// CreateUserDialog calls CreateUser, which creates the account AND the team membership in ONE
// transaction. So there is no window where a user exists with no team.
export function CreateUserDialog({
  open: openProp,
  onOpenChange,
}: {
  /**
   * Optional controlled mode: a caller may drive `open` and suppress the inline trigger. Absent,
   * the dialog triggers itself as before.
   *
   * LIFECYCLE ONLY — the `onDone` that used to sit beside it existed so the page could refetch
   * (#177), and the write invalidates the user cache itself now.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { current } = useTeam();

  const roles = rolesFor(current?.teamType);

  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;

  const save = useCreateUser();
  const busy = save.isPending;

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

  function submit(event: FormEvent) {
    event.preventDefault();

    // Username is lowercase alphanumeric only (#87) — the backend enforces the same rule.
    if (!/^[a-z0-9]+$/.test(username)) {
      setError(t("users.create.usernameError"));
      return;
    }

    setError("");

    save.mutate(
      {
        // The CURRENT TEAM is the scope. It travels in the message body — the backend's
        // (use_scope) option reads it from there, not from a header.
        teamId: current?.teamId ?? 0n,
        username,
        password,
        name,
        email,
        role,
        alias: "",
      },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("users.toast.userCreated", { username }) });

          setUsername("");
          setPassword("");
          setName("");
          setEmail("");
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
          <Button size="xs" colorPalette="brand" data-testid="open-create-user">
            {t("users.newUser")}
          </Button>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("users.create.title")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="create-user-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("users.field.username")}</Field.Label>
                    <Input
                      value={username}
                      data-testid="new-username"
                      onChange={(e) => setUsername(e.target.value)}
                    />
                    <Field.HelperText>{t("users.helper.usernameRule")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("users.field.password")}</Field.Label>
                    <PasswordInput
                      value={password}
                      data-testid="new-password"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <Field.HelperText>{t("users.helper.min8")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("users.field.name")}</Field.Label>
                    <Input value={name} data-testid="new-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("users.field.email")}</Field.Label>
                    <Input value={email} data-testid="new-email" onChange={(e) => setEmail(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("users.create.roleInTeam", { team: current?.teamName || t("users.thisTeam") })}</Field.Label>
                    <RoleSelect teamType={current?.teamType} value={role} onChange={setRole} />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("users.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-create-user">
                  {t("users.create.submit")}
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
