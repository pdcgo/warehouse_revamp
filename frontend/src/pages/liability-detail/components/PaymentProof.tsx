import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Flex, Icon, Text } from "@chakra-ui/react";
import { Paperclip } from "lucide-react";

import { documentClient, rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";

interface PaymentProofProps {
  /** The READER's team — the creditor checking, or the payer re-reading their own claim. */
  teamId: bigint;
  documentIds: string[];
}

// PaymentProof is the middle step of `balance_context.md` §Payment Flow — *"Team B check manually"*.
//
// ⚠ WITHOUT THIS THE FLOW HAS NO MIDDLE. The payer's upload half shipped (`useProofUpload`), the
// document ids reach the client on every payment, and there was still nowhere on any screen to LOOK at
// them — so the creditor was being asked to confirm a bank transfer on the payer's word, which is the
// one thing two-phase confirmation exists to decline.
//
// ⚠ THE URL IS MINTED ON CLICK, never on render. A signed URL resolved when the table loads would
// expire while somebody reads the page, and would mint one per payment for files nobody opened. Same
// reasoning as `ReceiptCard`, and deliberately the same shape.
//
// ⚠ THE READ WORKS BECAUSE THE PAYER SHARED IT. `GetDownloadUrl` scopes to the owning team plus its
// `document_shares` rows — the payer granted the creditor that row before recording the payment
// (a-payment-must-carry-proof). If a payment ever renders proof it cannot open, the share is what to
// look for, not this component.
export function PaymentProof({ teamId, documentIds }: PaymentProofProps) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState("");

  // ⚠ NOT AN EMPTY CELL. A payment with nothing attached should read as a stated absence — the
  // contract requires at least one document, so "none" means something went wrong rather than
  // "the payer chose not to".
  if (documentIds.length === 0) {
    return (
      <Text color="fg.muted" fontSize="xs">
        {t("liabilityDetail.proofNone")}
      </Text>
    );
  }

  async function open(documentId: string) {
    setOpening(documentId);

    try {
      const res = await documentClient.getDownloadUrl({ teamId, documentId });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    } finally {
      setOpening("");
    }
  }

  return (
    <Flex align="center" gap="1" wrap="wrap">
      {documentIds.map((id, i) => (
        <Button
          key={id}
          size="xs"
          variant="ghost"
          loading={opening === id}
          data-testid={`liability-detail-proof-${id}`}
          onClick={() => open(id)}
        >
          <Icon as={Paperclip} boxSize="3" />
          {/* Numbered rather than named: the id is opaque here and the filename lives in
              document_service, so a second RPC per row would buy a label nobody needs to read. */}
          {t("liabilityDetail.proofNth", { n: i + 1 })}
        </Button>
      ))}
    </Flex>
  );
}
