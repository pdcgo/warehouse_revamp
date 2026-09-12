import { useState } from "react";
import { Link, Stack } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { Alert } from "../../components/display/Alert";
import { Button } from "../../components/inputs/Button";
import { Field } from "../../components/inputs/Field";
import { PasswordInput } from "../../../components/inputs/PasswordInput";
import { TextInput } from "../../components/inputs/TextInput";
import { AuthShell } from "../_auth/AuthShell";

// The account-creation screen.
//
// The confirm-password field is checked ON THE CLIENT and reported inline, which is the one piece of
// validation genuinely worth doing here rather than on the server: a typo in a password you cannot
// see is invisible until the next sign-in fails, and by then the person has no way to know what they
// actually typed. Everything else — username taken, password strength — is the server's answer.
export const description =
  "Account creation. The password confirmation is checked client-side and reported inline — a typo in a field you cannot read is otherwise invisible until the next sign-in fails.";

export interface RegisterPageProps {
  onSubmit?(values: { username: string; name: string; password: string }): void;
  error?: string;
  busy?: boolean;
}

export function RegisterPage({ onSubmit, error, busy }: RegisterPageProps) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Only once something has been typed — complaining about a mismatch against an empty box would
  // flag the form as wrong before it has been filled in.
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <AuthShell
      title="Create an account"
      subtitle="You will still need a team owner to add you to a team."
      footer={
        <Link asChild>
          <RouterLink to="/login">Already have an account? Sign in</RouterLink>
        </Link>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}

      <Stack gap="card">
        <Field label="Name" required>
          <TextInput value={name} onChange={setName} data-testid="register-name" />
        </Field>

        <Field label="Username" required hint="Used to sign in. Letters, numbers and dots.">
          <TextInput
            value={username}
            onChange={setUsername}
            autoComplete="username"
            data-testid="register-username"
          />
        </Field>

        <Field label="Password" required>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            data-testid="register-password"
          />
        </Field>

        <Field
          label="Confirm password"
          required
          error={mismatch ? "The two passwords do not match." : undefined}
        >
          <PasswordInput
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            data-testid="register-confirm"
          />
        </Field>

        <Button
          // Blocked while they disagree: submitting would create an account whose password is not
          // the one the person thinks they chose.
          disabled={mismatch || password.length === 0}
          loading={busy}
          onClick={() => onSubmit?.({ username, name, password })}
          w="full"
          data-testid="register-submit"
        >
          Create account
        </Button>
      </Stack>
    </AuthShell>
  );
}
