import { useState } from "react";
import { Avatar, Button, FileUpload, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { Camera } from "lucide-react";
import { documentClient, rpcError } from "../../../api/clients";
import { DocumentResourceType } from "../../../gen/warehouse/document/v1/document_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { useTeamDetail, useUpdateTeam } from "../../../features/teams/queries";
import { toaster } from "../../../components/Toaster";
import { isTeamManager } from "../../../lib/roles";

// TeamPicture shows the CURRENT team's picture and lets a team manager replace it.
//
// The upload is TWO-PHASE against document_service, exactly like the user avatar: RequestUpload
// hands back a short-lived storage URL, the browser PUTs the raw bytes straight there (the server
// never touches them), then ConfirmUpload turns the pending row into a finished Document. Only then
// do we point the team at the (compact) thumbnail via TeamUpdate.
//
// The upload is SCOPED to the current team — document_service reads team_id from the request body
// (the (use_scope) option), so with no current team there is nothing to scope to and the control
// is disabled. The manager gate is UX only; the backend interceptor is the real boundary.
export function TeamPicture() {
  const { current, refresh } = useTeam();

  const [busy, setBusy] = useState(false);

  const teamId = current?.teamId;
  const canEdit = isTeamManager(current?.role);
  const noTeam = !current;
  const name = current?.teamName || "Team";

  // TeamAccessList (what `current` comes from) does not carry the picture, so it is read from
  // TeamDetail — through the shared hook, so the settings page, the detail page and this all show
  // one answer, and a save from any of them moves the others.
  //
  // A failed read is non-fatal: no image falls back to the initials, exactly as before.
  const detail = useTeamDetail({ teamId: teamId ?? 0n, enabled: teamId !== undefined });
  const imageUrl = detail.data?.imageUrl ?? "";

  const updateTeam = useUpdateTeam();

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

      // Prefer the compact thumbnail; fall back to the full public URL if the server did not emit
      // one.
      const url = conf.document?.thumbnailUrl || conf.document?.publicUrl || "";

      // 4. Point the team at it. ONLY `imageUrl` — the name and description are omitted rather than
      // sent empty, because absent means leave alone and present-and-empty would erase them.
      //
      // The displayed image is no longer set from the response: the mutation invalidates the team
      // queries, so the picture this component reads updates itself.
      await updateTeam.mutateAsync({ teamId: current.teamId, imageUrl: url });

      // Reflect the new picture in the team switcher too.
      await refresh();

      toaster.create({ type: "success", title: "Team picture updated" });
    } catch (err) {
      toaster.create({ type: "error", title: "Upload failed", description: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || noTeam || !canEdit;

  return (
    <HStack gap="card" align="center">
      <Avatar.Root shape="rounded" size="2xl" colorPalette="brand" data-testid="team-picture">
        <Avatar.Fallback name={name} />
        <Avatar.Image src={imageUrl || undefined} alt={name} />
      </Avatar.Root>

      <Stack gap="1">
        <FileUpload.Root
          accept="image/*"
          disabled={disabled}
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
              disabled={disabled}
              data-testid="change-team-picture"
            >
              <Icon as={Camera} />
              Change picture
            </Button>
          </FileUpload.Trigger>
        </FileUpload.Root>

        <Text color="fg.muted" fontSize="xs">
          {noTeam
            ? "Select a team first to change its picture."
            : !canEdit
              ? "Only a team owner or admin can change the picture."
              : "JPG or PNG, shown across the app."}
        </Text>
      </Stack>
    </HStack>
  );
}
