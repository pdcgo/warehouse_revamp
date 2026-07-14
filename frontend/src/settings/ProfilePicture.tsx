import { useState } from "react";
import { Avatar, Button, FileUpload, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { Camera } from "lucide-react";
import { documentClient, rpcError, userClient } from "../api/clients";
import { DocumentResourceType } from "../gen/warehouse/document/v1/document_pb";
import { useTeam } from "../team/TeamContext";
import { toaster } from "../components/Toaster";

interface ProfilePictureProps {
  avatarUrl?: string;
  name?: string;
  onUpdated: (newAvatarUrl: string) => void;
}

// ProfilePicture shows the caller's avatar and lets them replace it.
//
// The upload is TWO-PHASE against document_service, exactly as the contract demands: RequestUpload
// hands back a short-lived storage URL, the browser PUTs the raw bytes straight there (the server
// never touches them), then ConfirmUpload turns the pending row into a finished Document. Only then
// do we point the profile at the (compact) thumbnail via UpdateProfile.
//
// The upload is SCOPED to the current team — document_service reads team_id from the request body
// (the (use_scope) option), so with no current team there is nothing to scope to and the control
// is disabled.
export function ProfilePicture({ avatarUrl, name, onUpdated }: ProfilePictureProps) {
  const { current } = useTeam();
  const [busy, setBusy] = useState(false);

  const noTeam = !current;

  async function upload(file: File) {
    if (!current) {
      return;
    }

    setBusy(true);

    try {
      // 1. Ask the service where to put the bytes.
      const req = await documentClient.requestUpload({
        teamId: current.teamId,
        resourceType: DocumentResourceType.PROFILE_PICTURE,
        contentType: file.type,
        sizeBytes: BigInt(file.size),
        filename: file.name,
      });

      // 2. PUT the raw file straight to object storage, echoing the signed headers verbatim.
      const res = await fetch(req.uploadUrl, {
        method: req.method,
        headers: req.headers,
        body: file,
      });

      if (!res.ok) {
        throw new Error(`Upload failed (${res.status} ${res.statusText})`);
      }

      // 3. Confirm — this is what promotes the pending upload into a real Document.
      const conf = await documentClient.confirmUpload({ uploadToken: req.uploadToken });

      // Prefer the compact thumbnail (that is the whole point of an avatar); fall back to the
      // full public URL if the server did not emit one.
      const url = conf.document?.thumbnailUrl || conf.document?.publicUrl || "";

      // 4. Point the profile at it.
      await userClient.updateProfile({ avatarUrl: url });

      onUpdated(url);
      toaster.create({ type: "success", title: "Profile picture updated" });
    } catch (err) {
      toaster.create({ type: "error", title: "Upload failed", description: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <HStack gap="card" align="center">
      <Avatar.Root size="2xl" colorPalette="brand" data-testid="profile-picture">
        <Avatar.Fallback name={name} />
        <Avatar.Image src={avatarUrl || undefined} alt={name} />
      </Avatar.Root>

      <Stack gap="1">
        <FileUpload.Root
          accept="image/*"
          disabled={busy || noTeam}
          onFileChange={(details) => {
            const file = details.acceptedFiles[0];

            if (file) {
              void upload(file);
            }
          }}
        >
          <FileUpload.HiddenInput />
          <FileUpload.Trigger asChild>
            <Button
              variant="outline"
              colorPalette="brand"
              loading={busy}
              disabled={noTeam}
              data-testid="change-picture"
            >
              <Icon as={Camera} />
              Change picture
            </Button>
          </FileUpload.Trigger>
        </FileUpload.Root>

        <Text color="fg.muted" fontSize="xs">
          {noTeam ? "Select a team first to change your picture." : "JPG or PNG, shown across the app."}
        </Text>
      </Stack>
    </HStack>
  );
}
