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
import { isRemembered, setToken } from "../auth/tokenStorage";
import { toaster } from "../components/Toaster";

// ChangePasswordDialog calls ResetPassword — the SELF-SERVE one, which has no user_id field.
//
// It returns a FRESH token, and storing it is not optional: a password change invalidates every
// token issued before it, INCLUDING the one this browser is holding. Drop the new token and the
// user logs themselves out by changing their password.
export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (newPassword !== confirm) {
      setError("The new passwords do not match.");

      return;
    }

    setBusy(true);
    setError("");

    try {
      const res = await userClient.resetPassword({ oldPassword, newPassword });

      // Write the replacement token back to the SAME store the old one came from, or a
      // "remember me" session would silently downgrade to a tab-scoped one.
      setToken(res.token, isRemembered());

      toaster.create({
        type: "success",
        title: "Password changed",
        description: "Other sessions have been signed out.",
      });

      setOldPassword("");
      setNewPassword("");
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
      <Dialog.Trigger asChild>
        <Button size="xs" variant="outline" data-testid="open-change-password">
          Change password
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>Change Password</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="password-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>Current password</Field.Label>
                    <Input
                      type="password"
                      value={oldPassword}
                      autoComplete="current-password"
                      data-testid="old-password"
                      onChange={(e) => setOldPassword(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>New password</Field.Label>
                    <Input
                      type="password"
                      value={newPassword}
                      autoComplete="new-password"
                      data-testid="new-password-1"
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <Field.HelperText>At least 8 characters.</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>Confirm new password</Field.Label>
                    <Input
                      type="password"
                      value={confirm}
                      autoComplete="new-password"
                      data-testid="new-password-2"
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-change-password">
                  Change password
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
