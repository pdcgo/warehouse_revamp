import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
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
import { rpcError } from "../../../api/clients";
import type { User } from "../../../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../../../features/auth/AuthContext";
import { toaster } from "../../../components/feedback/Toaster";
import { useSaveUser } from "../../../features/users/queries";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { USERS_PENDING } from "../pending";

// User 1 is the system's first Root and keeps the name `root` (the-username-is-editable).
const ROOT_USER_ID = 1n;

// EditUserDialog calls UpdateProfile when you are editing YOURSELF, and UpdateUser otherwise.
//
// They are two different RPCs with two different policies on purpose: UpdateProfile has no
// user_id at all (the subject is the token holder), while UpdateUser is root/admin-only. One RPC
// meaning both is exactly how the source produced an IDOR.
//
// The USERNAME is editable on someone else's account only (the-username-is-editable): a typo is fixed
// in place, never by making the account again. UpdateProfile has no username, so your own stays put.
export function EditUserDialog({
  user,
  open: openProp,
  onOpenChange,
}: {
  user: User;
  /**
   * Optional controlled mode: when opened from a row's actions menu the page owns `open` and no
   * inline trigger is rendered. Absent, the dialog triggers itself as before.
   *
   * LIFECYCLE ONLY — what clears the parent's open-dialog state. The `onDone` beside it existed so
   * the table could refetch (#177); the write invalidates the user cache itself now.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { identity } = useAuth();

  const isSelf = identity?.identityId === user.id;

  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;

  const save = useSaveUser();
  const busy = save.isPending;

  function setOpen(next: boolean) {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
    }
  }

  const [error, setError] = useState("");

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phoneNumber);
  const [username, setUsername] = useState(user.username);

  const usernameLocked = user.id === ROOT_USER_ID;

  function submit(event: FormEvent) {
    event.preventDefault();

    // The same rule as create (#87) — the server enforces it too.
    if (!isSelf && !/^[a-z0-9]+$/.test(username)) {
      setError(t("users.create.usernameError"));
      return;
    }

    setError("");

    // Every field is `optional` in the proto. Sending them all is fine here because the form holds
    // the current values — but the backend distinguishes absent from empty, so a partial update
    // never blanks what it did not touch.
    //
    // An OMITTED userId is what selects UpdateProfile over UpdateUser inside the hook — the same
    // two-RPCs-one-form split this dialog already made, moved to where the call is.
    save.mutate(
      {
        userId: isSelf ? undefined : user.id,
        // Sent only when it changed, so an untouched form never rewrites it.
        username: !isSelf && username !== user.username ? username : undefined,
        name,
        email,
        phoneNumber: phone,
      },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("users.toast.userUpdated", { username: user.username }) });
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
          <IconButton size="xs" variant="ghost" aria-label="Edit" data-testid={`edit-${user.username}`}>
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
                <Dialog.Title>{t("users.edit.title", { username: user.username })}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="error.fg" data-testid="edit-user-error">
                      {error}
                    </Text>
                  )}

                  {!isSelf && (
                    <Field.Root disabled={usernameLocked}>
                      <Field.Label>
                        {t("users.field.username")}
                        <NotImplemented list={USERS_PENDING} id="username" />
                      </Field.Label>
                      <Input
                        value={username}
                        data-testid="edit-username"
                        onChange={(ev) => setUsername(ev.target.value)}
                      />
                      <Field.HelperText>
                        {usernameLocked ? t("users.helper.rootUsername") : t("users.helper.usernameRule")}
                      </Field.HelperText>
                    </Field.Root>
                  )}

                  <Field.Root>
                    <Field.Label>{t("users.field.name")}</Field.Label>
                    <Input value={name} data-testid="edit-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("users.field.email")}</Field.Label>
                    <Input value={email} data-testid="edit-email" onChange={(e) => setEmail(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("users.field.phone")}</Field.Label>
                    <Input value={phone} data-testid="edit-phone" onChange={(e) => setPhone(e.target.value)} />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("users.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-edit-user">
                  {t("users.edit.save")}
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
