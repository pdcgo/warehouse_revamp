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
import { rpcError, userClient } from "../api/clients";
import { useAuth } from "../auth/AuthContext";
import { toaster } from "../components/Toaster";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { ProfilePicture } from "./ProfilePicture";

// ProfilePage is the caller editing THEMSELVES.
//
// Both RPCs it uses (UpdateProfile, ResetPassword) have NO user_id field at all — the subject is
// always the token holder. That is not a check that can be forgotten; it is a shape that cannot
// express the wrong thing.
export function ProfilePage() {
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
      toaster.create({ type: "success", title: "Profile updated" });
    } catch (err) {
      toaster.create({ type: "error", title: "Update failed", description: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  return (
    <Stack gap="section" maxW="md">
      <Heading size="md">My Profile</Heading>

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
                Signed in as <strong>{identity?.username}</strong>
              </Text>

              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input value={name} data-testid="profile-name" onChange={(e) => setName(e.target.value)} />
              </Field.Root>

              <Field.Root>
                <Field.Label>Email</Field.Label>
                <Input value={email} data-testid="profile-email" onChange={(e) => setEmail(e.target.value)} />
              </Field.Root>

              <Field.Root>
                <Field.Label>Phone</Field.Label>
                <Input value={phone} data-testid="profile-phone" onChange={(e) => setPhone(e.target.value)} />
              </Field.Root>

              <Button type="submit" colorPalette="brand" loading={busy} data-testid="save-profile">
                Save
              </Button>
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Heading size="sm">Password</Heading>

            <Text color="fg.muted" fontSize="sm">
              Changing your password signs out every other session — any token issued before the
              change stops working immediately.
            </Text>

            <ChangePasswordDialog />
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
