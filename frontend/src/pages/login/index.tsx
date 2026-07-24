import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Checkbox } from "../../components/ui/Checkbox";
import { Field } from "../../components/ui/Field";
import { Logo } from "../../components/Logo";
import { PasswordInput } from "../../components/PasswordInput";
import { ForgotPasswordDialog } from "./components/ForgotPasswordDialog";
import { useAuth } from "../../features/auth/AuthContext";

export function LoginPage() {
  const { t } = useTranslation();
  const { identity, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (identity) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await login(username, password, remember);
      void navigate("/", { replace: true });
    } catch (err) {
      // The server returns the SAME message for an unknown user and a wrong password — do not
      // embellish it here, or the UI reintroduces the account-enumeration leak the API avoids.
      setError(err instanceof Error ? err.message : t("account.loginFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-page">
      <Card className="w-full max-w-sm">
        <CardBody>
          <form onSubmit={onSubmit}>
            <div className="flex flex-col gap-section">
              <Logo size={40} className="justify-center pb-1" />

              <h1 className="text-[22px] font-bold">{t("account.signIn")}</h1>

              {error && (
                <div
                  role="alert"
                  data-testid="login-error"
                  className="flex items-start gap-2 rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Field.Root>
                <Field.Label>{t("account.username")}</Field.Label>
                <Field.Input
                  value={username}
                  autoComplete="username"
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>{t("account.password")}</Field.Label>
                <PasswordInput
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field.Root>

              <Checkbox checked={remember} onCheckedChange={setRemember}>
                {t("account.rememberMe")}
              </Checkbox>

              <Button type="submit" colorPalette="brand" loading={busy}>
                {t("account.signIn")}
              </Button>

              <div className="flex justify-center">
                <ForgotPasswordDialog />
              </div>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
