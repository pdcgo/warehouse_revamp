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
import { rpcError } from "../api/clients";
import type { User } from "../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../auth/AuthContext";
import { toaster } from "../components/Toaster";
import { useSaveUser } from "./queries";

// EditUserDialog calls UpdateProfile when you are editing YOURSELF, and UpdateUser otherwise.
//
// They are two different RPCs with two different policies on purpose: UpdateProfile has no
// user_id at all (the subject is the token holder), while UpdateUser is root/admin-only. One RPC
// meaning both is exactly how the source produced an IDOR.
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

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    // Every field is `optional` in the proto. Sending them all is fine here because the form holds
    // the current values — but the backend distinguishes absent from empty, so a partial update
    // never blanks what it did not touch.
    //
    // An OMITTED userId is what selects UpdateProfile over UpdateUser inside the hook — the same
    // two-RPCs-one-form split this dialog already made, moved to where the call is.
    save.mutate(
      { userId: isSelf ? undefined : user.id, name, email, phoneNumber: phone },
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
                    <Text color="red.fg" data-testid="edit-user-error">
                      {error}
                    </Text>
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
