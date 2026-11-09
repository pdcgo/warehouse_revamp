import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Icon, Span } from "@chakra-ui/react";
import { ImageIcon } from "lucide-react";

import { documentClient, restockClient, rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";

export interface ReceiptPhotoProps {
  /** `restock.receipt_file` — the DOCUMENT ID ReceiptUpload stored, never a URL. Empty = nothing attached. */
  documentId: string;
  /** The reading team, sent as the scope of the call that mints the link. */
  teamId: bigint;
  /** The restock — what the warehouse asks about (RestockReceiptPhoto checks it is going to that warehouse). */
  requestId: bigint;
  /**
   * How this reader opens it. The photo is the SELLING team's upload:
   *
   *   - `owner` — the selling team, as the file's owner, through document_service's GetDownloadUrl;
   *   - `warehouse` — the warehouse the restock is going to, through inventory's RestockReceiptPhoto, which checks the
   *     restock is its own and has document_service sign the seller's file in-process
   *     (the-restocks-warehouse-opens-its-label-photo). GetDownloadUrl as the warehouse is NotFound: nothing shares it.
   */
  opensAs: "owner" | "warehouse";
}

/**
 * The photo of a restock's label (the-receipt-is-the-tracking-number: `receipt_file` is a photo of the resi).
 *
 * The link is MINTED ON CLICK, never rendered as an href: the stored value is a document id, and a signed URL minted on
 * render would expire on an open page. A refusal (another warehouse's restock, the file gone) is said in a toast.
 */
export function ReceiptPhoto({ documentId, teamId, requestId, opensAs }: ReceiptPhotoProps) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);

  if (!documentId) {
    return (
      <Span fontSize="xs" color="fg.muted" data-testid="restock-detail-receipt-photo">
        {t("restock.detail.noReceiptPhoto")}
      </Span>
    );
  }

  async function open() {
    setOpening(true);

    try {
      const res =
        opensAs === "warehouse"
          ? await restockClient.restockReceiptPhoto({ teamId, requestId })
          : await documentClient.getDownloadUrl({ teamId, documentId });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    } finally {
      setOpening(false);
    }
  }

  return (
    <Button
      size="xs"
      variant="ghost"
      // Under the tracking number, flush left — not stretched across the field by its Stack.
      alignSelf="flex-start"
      loading={opening}
      data-testid="restock-detail-receipt-photo-open"
      onClick={open}
    >
      <Icon as={ImageIcon} boxSize="3" />
      {t("restock.detail.openReceiptPhoto")}
    </Button>
  );
}
