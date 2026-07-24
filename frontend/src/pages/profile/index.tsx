import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { rpcError, userClient } from "../../api/clients";
import { useAuth } from "../../features/auth/AuthContext";
import { toaster } from "../../components/Toaster";
import { Button } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { Spinner } from "../../components/ui/Spinner";
import { ChangePasswordDialog } from "./components/ChangePasswordDialog";
import { ProfilePicture } from "./components/ProfilePicture";

// ProfilePage is the caller editing THEMSELVES.
//
// Both RPCs it uses (UpdateProfile, ResetPassword) have NO user_id field at all — the subject is
// always the token holder. That is not a check that can be forgotten; it is a shape that cannot
// express the wrong thing.
export function ProfilePage() {
  const { t } = useTranslation();
  const { identity } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // There is no "get me" RPC — but UserByIDs resolves any id to a PublicUser, and we know ours.
  // (PublicUser has no email/phone by design, so we start those blank and let the user fill
  // them; a dedicated Me RPC would be the cleaner fix if this page grows.)
  useEffect(() => {
    if (!identity) {
      return;
    }

    void (async () => {
      try {
        const res = await userClient.userByIDs({ ids: [identity.identityId] });
        const me = res.data[identity.identityId.toString()];

        setName(me?.name ?? "");
        setAvatarUrl(me?.avatarUrl ?? "");
      } catch {
        // Non-fatal: the form still works, it just starts empty.
      } finally {
        setLoading(false);
      }
    })();
  }, [identity]);

  async function save(event: FormEvent) {
    event.preventDefault();

    setBusy(true);

    try {
      await userClient.updateProfile({ name, email, phoneNumber: phone });
      toaster.create({ type: "success", title: t("account.profileUpdated") });
    } catch (err) {
      toaster.create({ type: "error", title: t("account.updateFailed"), description: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Spinner />;
  }

  return (
    <div className="flex max-w-md flex-col gap-section">
      <h1 className="text-[22px] font-bold">{t("account.myProfile")}</h1>

      <Card>
        <CardBody>
          <ProfilePicture
            avatarUrl={avatarUrl || undefined}
            name={name || identity?.username}
            onUpdated={(newAvatarUrl) => setAvatarUrl(newAvatarUrl)}
          />
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <form onSubmit={save}>
            <div className="flex flex-col gap-card">
              <p className="text-sm text-fg-muted" data-testid="profile-username">
                {t("account.signedInAs")} <strong>{identity?.username}</strong>
              </p>

              <Field.Root>
                <Field.Label>{t("account.name")}</Field.Label>
                <Field.Input value={name} data-testid="profile-name" onChange={(e) => setName(e.target.value)} />
              </Field.Root>

              <Field.Root>
                <Field.Label>{t("account.email")}</Field.Label>
                <Field.Input value={email} data-testid="profile-email" onChange={(e) => setEmail(e.target.value)} />
              </Field.Root>

              <Field.Root>
                <Field.Label>{t("account.phone")}</Field.Label>
                <Field.Input value={phone} data-testid="profile-phone" onChange={(e) => setPhone(e.target.value)} />
              </Field.Root>

              <Button type="submit" colorPalette="brand" loading={busy} data-testid="save-profile">
                {t("account.save")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-card">
            <h2 className="text-[15px] font-semibold">{t("account.password")}</h2>

            <p className="text-sm text-fg-muted">{t("account.changePasswordWarning")}</p>

            <ChangePasswordDialog />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
