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
import { rpcError, userClient } from "../api/clients";
import type { User } from "../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../auth/AuthContext";
import { toaster } from "../components/Toaster";

// EditUserDialog calls UpdateProfile when you are editing YOURSELF, and UpdateUser otherwise.
//
// They are two different RPCs with two different policies on purpose: UpdateProfile has no
// user_id at all (the subject is the token holder), while UpdateUser is root/admin-only. One RPC
// meaning both is exactly how the source produced an IDOR.
export function EditUserDialog({
  user,
  onDone,
  open: openProp,
  onOpenChange,
}: {
  user: User;
  onDone: () => void;
  // Optional controlled mode: when opened from a row's actions menu the page owns `open` and no
  // inline trigger is rendered. Absent, the dialog triggers itself as before.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { identity } = useAuth();

  const isSelf = identity?.identityId === user.id;

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

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phoneNumber);

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      // Every field is `optional` in the proto. Sending them all is fine here because the form
      // holds the current values — but the backend distinguishes absent from empty, so a partial
      // update never blanks what it did not touch.
      if (isSelf) {
        await userClient.updateProfile({ name, email, phoneNumber: phone });
      } else {
        await userClient.updateUser({ userId: user.id, name, email, phoneNumber: phone });
      }

      toaster.create({ type: "success", title: `${user.username} updated` });
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
                <Dialog.Title>Edit {user.username}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="edit-user-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root>
                    <Field.Label>Name</Field.Label>
                    <Input value={name} data-testid="edit-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Email</Field.Label>
                    <Input value={email} data-testid="edit-email" onChange={(e) => setEmail(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Phone</Field.Label>
                    <Input value={phone} data-testid="edit-phone" onChange={(e) => setPhone(e.target.value)} />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-edit-user">
                  Save
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
