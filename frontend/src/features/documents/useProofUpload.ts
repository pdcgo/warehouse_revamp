import { useCallback, useState } from "react";

import { documentClient, rpcError } from "../../api/clients";
import { DocumentResourceType } from "../../gen/warehouse/document/v1/document_pb";

// One file that has finished uploading and been shared with the counterparty.
export interface UploadedProof {
  id: string;
  filename: string;
}

// ⚠ FOUR CALLS, AND THE SHARE IS ONE OF THEM (a-payment-must-carry-proof).
//
//   RequestUpload → PUT the bytes → ConfirmUpload → ShareDocument
//
// The share is the whole reason this is a hook rather than three lines in a dialog. A payment's proof
// is uploaded by the PAYER and has to be read by the CREDITOR, and `GetDownloadUrl` scopes every read
// to the owning team — so without the fourth call the creditor gets NotFound on the one file they are
// being asked to check.
//
// ⚠ THE PAYER GRANTS IT, AS THEMSELVES. That is what keeps document_service from ever asking another
// service for permission, and what keeps its invariant intact: there is no read without a row saying
// you may. The alternative was an internal signing path that let liability_service vouch for the
// reader — one bug in its relation check would leak every private file in the system.
export function useProofUpload(args: { teamId: bigint; shareWithTeamId: bigint }) {
  const { teamId, shareWithTeamId } = args;

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = useCallback(
    async (file: File): Promise<UploadedProof | undefined> => {
      setUploading(true);
      setError("");

      try {
        const requested = await documentClient.requestUpload({
          teamId,
          resourceType: DocumentResourceType.PAYMENT_PROOF,
          contentType: file.type || "application/octet-stream",
          sizeBytes: BigInt(file.size),
          filename: file.name,
        });

        // ⚠ THE HEADERS MUST BE ECHOED. The signed URL is signed over them, so a PUT that drops one is
        // rejected by the store rather than by us — and the failure would arrive as an opaque 403.
        const put = await fetch(requested.uploadUrl, {
          method: requested.method || "PUT",
          headers: requested.headers,
          body: file,
        });
        if (!put.ok) {
          throw new Error(`upload failed with ${put.status}`);
        }

        const confirmed = await documentClient.confirmUpload({
          uploadToken: requested.uploadToken,
        });

        const document = confirmed.document;
        if (!document) {
          throw new Error("the upload confirmed but returned no document");
        }

        // ⚠ WITHOUT THIS THE CREDITOR CANNOT OPEN IT. It is a separate call rather than a flag on the
        // upload because sharing is an act about a named counterparty, not a property of a file.
        await documentClient.shareDocument({
          teamId,
          documentId: document.id,
          withTeamId: shareWithTeamId,
        });

        return { id: document.id, filename: document.filename || file.name };
      } catch (err) {
        setError(rpcError(err));

        return undefined;
      } finally {
        setUploading(false);
      }
    },
    [teamId, shareWithTeamId],
  );

  return { upload, uploading, error, setError };
}
