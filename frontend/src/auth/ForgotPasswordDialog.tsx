import { useState } from "react";
import type { FormEvent } from "react";
import {
  Alert,
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { authClient, rpcError } from "../api/clients";
import { PasswordInput } from "../components/PasswordInput";
import { toaster } from "../components/Toaster";

// ForgotPasswordDialog drives the public OTP recovery flow, both steps of which are on
// AuthService and require no token (you can't log in — that's the point):
//
//   1. RequestPasswordResetOtp(username) — ALWAYS succeeds. It never says whether the username
//      exists or has a phone, so the UI must not either: we always advance to step 2. Claiming
//      "code sent!" only when the account exists would rebuild the enumeration oracle the API
//      carefully avoids.
//   2. ResetPasswordWithOtp(username, code, new_password) — verifies the code and sets the
//      password. It returns NO token: recovery ends at the login screen, a clean new session.
type Step = "request" | "verify";

export function ForgotPasswordDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("request");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function reset() {
    setStep("request");
    setError("");
    setUsername("");
    setCode("");
    setNewPassword("");
    setConfirm("");
  }

  async function requestCode(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await authClient.requestPasswordResetOtp({ username });

      // Advance UNCONDITIONALLY. The server did not tell us whether a code was really sent, and
      // neither do we.
      setStep("verify");
    } catch (err) {
      // A transport/system failure is a real error worth showing; it leaks nothing about the
      // account (the handler is a silent no-op for unknown users).
      setError(rpcError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault();

    if (newPassword !== confirm) {
      setError("The new passwords do not match.");

      return;
    }

    setBusy(true);
    setError("");

    try {
      await authClient.resetPasswordWithOtp({ username, code, newPassword });

      toaster.create({
        type: "success",
        title: "Password reset",
        description: "Sign in with your new password.",
      });

      setOpen(false);
      reset();
    } catch (err) {
      // Unknown-user and bad-code return the SAME message from the server — do not embellish it.
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
          reset();
        }
      }}
    >
      <Dialog.Trigger asChild>
        {/* type="button" is load-bearing: this trigger renders INSIDE the login page's <form>,
            and a <button> with no type defaults to submit — so clicking it would fire an empty
            login on top of opening the dialog. */}
        <Button type="button" variant="plain" size="xs" colorPalette="brand" data-testid="open-forgot-password">
          Forgot password?
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Reset Password</Dialog.Title>
            </Dialog.Header>

            {step === "request" ? (
              <form onSubmit={requestCode}>
                <Dialog.Body>
                  <Stack gap="card">
                    <Text color="fg.muted" fontSize="sm">
                      Enter your username. If it has a phone number on file, we'll text a
                      one-time code.
                    </Text>

                    {error && (
                      <Alert.Root status="error" data-testid="forgot-error">
                        <Alert.Indicator />
                        <Alert.Content>{error}</Alert.Content>
                      </Alert.Root>
                    )}

                    <Field.Root required>
                      <Field.Label>Username</Field.Label>
                      <Input
                        value={username}
                        autoComplete="username"
                        data-testid="forgot-username"
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </Field.Root>
                  </Stack>
                </Dialog.Body>

                <Dialog.Footer>
                  <Dialog.ActionTrigger asChild>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </Dialog.ActionTrigger>

                  <Button type="submit" colorPalette="brand" loading={busy} data-testid="request-otp">
                    Send code
                  </Button>
                </Dialog.Footer>
              </form>
            ) : (
              <form onSubmit={submitReset}>
                <Dialog.Body>
                  <Stack gap="card">
                    <Text color="fg.muted" fontSize="sm">
                      Enter the code sent to <strong>{username}</strong> and choose a new
                      password.
                    </Text>

                    {error && (
                      <Alert.Root status="error" data-testid="forgot-error">
                        <Alert.Indicator />
                        <Alert.Content>{error}</Alert.Content>
                      </Alert.Root>
                    )}

                    <Field.Root required>
                      <Field.Label>Code</Field.Label>
                      <Input
                        value={code}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        data-testid="otp-code"
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </Field.Root>

                    <Field.Root required>
                      <Field.Label>New password</Field.Label>
                      <PasswordInput
                        value={newPassword}
                        autoComplete="new-password"
                        data-testid="otp-new-password-1"
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                      <Field.HelperText>At least 8 characters.</Field.HelperText>
                    </Field.Root>

                    <Field.Root required>
                      <Field.Label>Confirm new password</Field.Label>
                      <PasswordInput
                        value={confirm}
                        autoComplete="new-password"
                        data-testid="otp-new-password-2"
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </Field.Root>
                  </Stack>
                </Dialog.Body>

                <Dialog.Footer>
                  <Button type="button" variant="outline" onClick={() => setStep("request")}>
                    Back
                  </Button>

                  <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-otp-reset">
                    Reset password
                  </Button>
                </Dialog.Footer>
              </form>
            )}

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
