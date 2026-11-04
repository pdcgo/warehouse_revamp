import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  Card,
  Field,
  Heading,
  Input,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError, userClient } from "../../api/clients";
import { useAuth } from "../../features/auth/AuthContext";
import { toaster } from "../../components/feedback/Toaster";
import { ChangePasswordDialog } from "./components/ChangePasswordDialog";
import { ProfilePicture } from "./components/ProfilePicture";
import { AgentConnectionsCard } from "./components/AgentConnectionsCard";

// ProfilePage is the caller editing THEMSELVES.
//
// Every RPC it uses (ProfileDetail, UpdateProfile, ResetPassword) has NO user_id field at all — the subject is
// always the token holder. That is not a check that can be forgotten; it is a shape that cannot
// express the wrong thing.
export function ProfilePage() {
  const { t } = useTranslation();
  const { identity } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  // What is STORED — the form's starting point, and what a save compares against. Only a field that differs from it
  // is sent: UpdateProfile reads an absent field as "leave alone", so a name-only save cannot blank the email or the
  // phone a password reset goes to.
  const [saved, setSaved] = useState({ name: "", email: "", phone: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // ProfileDetail is the caller's OWN row, email and phone included — what UserByIDs' PublicUser never carries.
  useEffect(() => {
    if (!identity) {
      return;
    }

    void (async () => {
      try {
        const me = (await userClient.profileDetail({})).user;
        const stored = { name: me?.name ?? "", email: me?.email ?? "", phone: me?.phoneNumber ?? "" };

        setSaved(stored);
        setName(stored.name);
        setEmail(stored.email);
        setPhone(stored.phone);
        setAvatarUrl(me?.avatarUrl ?? "");
      } catch {
        // Non-fatal: the form starts empty, and a save still sends only what was typed.
      } finally {
        setLoading(false);
      }
    })();
  }, [identity]);

  async function save(event: FormEvent) {
    event.preventDefault();

    setBusy(true);

    try {
      const res = await userClient.updateProfile({
        name: name !== saved.name ? name : undefined,
        email: email !== saved.email ? email : undefined,
        phoneNumber: phone !== saved.phone ? phone : undefined,
      });

      // The server's answer is the new baseline — a phone comes back in its one stored form.
      const user = res.user;
      if (user) {
        setSaved({ name: user.name, email: user.email, phone: user.phoneNumber });
        setName(user.name);
        setEmail(user.email);
        setPhone(user.phoneNumber);
      }

      toaster.create({ type: "success", title: t("account.profileUpdated") });
    } catch (err) {
      toaster.create({ type: "error", title: t("account.updateFailed"), description: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  return (
    <Stack gap="section" maxW="md">
      <Heading size="md">{t("account.myProfile")}</Heading>

      <Card.Root>
        <Card.Body>
          <ProfilePicture
            avatarUrl={avatarUrl || undefined}
            name={name || identity?.username}
            onUpdated={(newAvatarUrl) => setAvatarUrl(newAvatarUrl)}
          />
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <form onSubmit={save}>
            <Stack gap="card">
              <Text color="fg.muted" fontSize="sm" data-testid="profile-username">
                {t("account.signedInAs")} <strong>{identity?.username}</strong>
              </Text>

              <Field.Root>
                <Field.Label>{t("account.name")}</Field.Label>
                <Input value={name} data-testid="profile-name" onChange={(e) => setName(e.target.value)} />
              </Field.Root>

              <Field.Root>
                <Field.Label>{t("account.email")}</Field.Label>
                <Input value={email} data-testid="profile-email" onChange={(e) => setEmail(e.target.value)} />
              </Field.Root>

              <Field.Root>
                <Field.Label>{t("account.phone")}</Field.Label>
                <Input value={phone} data-testid="profile-phone" onChange={(e) => setPhone(e.target.value)} />
              </Field.Root>

              <Button type="submit" colorPalette="brand" loading={busy} data-testid="save-profile">
                {t("account.save")}
              </Button>
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Heading size="sm">{t("account.password")}</Heading>

            <Text color="fg.muted" fontSize="sm">
              {t("account.changePasswordWarning")}
            </Text>

            <ChangePasswordDialog />
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* The agents this person connected, and how to connect one (an-agent-gets-its-own-team-credential). */}
      <AgentConnectionsCard />
    </Stack>
  );
}
