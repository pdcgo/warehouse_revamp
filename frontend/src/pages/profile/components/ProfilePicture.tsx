import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import { documentClient, rpcError, userClient } from "../../../api/clients";
import { DocumentResourceType } from "../../../gen/warehouse/document/v1/document_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { toaster } from "../../../components/Toaster";
import { Button } from "../../../components/ui/Button";

interface ProfilePictureProps {
  avatarUrl?: string;
  name?: string;
  onUpdated: (newAvatarUrl: string) => void;
}

// The first letter of the first and last word of a name, upper-cased — the avatar's fallback when
// there is no picture (or the picture fails to load).
function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
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
  const { t } = useTranslation();
  const { current } = useTeam();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
      toaster.create({ type: "success", title: t("account.profilePictureUpdated") });
    } catch (err) {
      toaster.create({ type: "error", title: t("account.uploadFailed"), description: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-card">
      {/* Avatar: a brand-tinted circle showing initials, with the picture layered on top. The
          <img> hides itself if it fails to load, revealing the initials beneath. */}
      <div
        className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-lg font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300"
        data-testid="profile-picture"
      >
        <span>{initials(name)}</span>
        {avatarUrl && (
          <img
            key={avatarUrl}
            src={avatarUrl}
            alt={name}
            className="absolute inset-0 size-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy || noTeam}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void upload(file);
            }
            // Reset so picking the SAME file again still fires a change.
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          colorPalette="brand"
          loading={busy}
          disabled={noTeam}
          data-testid="change-picture"
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="size-4" />
          {t("account.changePicture")}
        </Button>

        <span className="text-xs text-fg-muted">
          {noTeam ? t("account.selectTeamForPicture") : t("account.pictureHint")}
        </span>
      </div>
    </div>
  );
}
