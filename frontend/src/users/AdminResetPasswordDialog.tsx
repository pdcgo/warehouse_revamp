import { useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Icon,
  IconButton,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { rpcError, userClient } from "../api/clients";
import type { User } from "../gen/warehouse/user/v1/user_pb";
import { PasswordInput } from "../components/PasswordInput";
import { toaster } from "../components/Toaster";

// AdminResetPasswordDialog calls AdminResetPassword — a DIFFERENT RPC from the self-serve
// ResetPassword, with a different policy (root/admin only) and no old password, because an admin
// does not know it.
//
// They are separate on purpose. One RPC meaning both "change my password" and "change anyone's
// password", gated as if it only meant the first, is exactly the IDOR this system was built to
// avoid — so the UI keeps them separate too.
export function AdminResetPasswordDialog({
  user,
  open: openProp,
  onOpenChange,
}: {
  user: User;
  // Optional controlled mode: when opened from a row's actions menu the page owns `open` and no
  // inline trigger is rendered. Absent, the dialog triggers itself as before.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
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

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (password !== confirm) {
      setError("The passwords do not match.");

      return;
    }

    setBusy(true);
    setError("");

    try {
      await userClient.adminResetPassword({ userId: user.id, newPassword: password });

      toaster.create({
        type: "success",
        title: `Password reset for ${user.username}`,
        // Worth saying out loud: this is not just "they can log in with a new password" — every
        // token they already hold stops working.
        description: "All of their existing sessions were signed out.",
      });

      setPassword("");
      setConfirm("");
      setOpen(false);
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
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Reset password"
            data-testid={`reset-password-${user.username}`}
          >
            <Icon as={KeyRound} boxSize="4" />
          </IconButton>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>Reset password for {user.username}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="admin-reset-error">
                      {error}
                    </Text>
                  )}

                  <Text fontSize="sm" color="fg.muted">
                    Sets a new password without knowing the old one. Every session this user
                    currently has will be signed out.
                  </Text>

                  <Field.Root required>
                    <Field.Label>New password</Field.Label>
                    <PasswordInput
                      value={password}
                      autoComplete="new-password"
                      data-testid="admin-new-password-1"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <Field.HelperText>At least 8 characters.</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>Confirm new password</Field.Label>
                    <PasswordInput
                      value={confirm}
                      autoComplete="new-password"
                      data-testid="admin-new-password-2"
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  data-testid="submit-admin-reset"
                >
                  Reset password
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
