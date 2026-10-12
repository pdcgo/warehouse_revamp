import { useTranslation } from "react-i18next";
import { Badge } from "@chakra-ui/react";
import { UploadedFileStatus } from "../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";

const COLOR: Record<UploadedFileStatus, string> = {
  [UploadedFileStatus.UNSPECIFIED]: "gray",
  [UploadedFileStatus.RUNNING]: "blue",
  // Not a failure: the server stopped mid-file, and the same file again completes it.
  [UploadedFileStatus.INTERRUPTED]: "orange",
  [UploadedFileStatus.DONE]: "green",
  [UploadedFileStatus.FAILED]: "red",
};

const LABEL: Record<UploadedFileStatus, string> = {
  [UploadedFileStatus.UNSPECIFIED]: "settlementImports.status.unknown",
  [UploadedFileStatus.RUNNING]: "settlementImports.status.running",
  [UploadedFileStatus.INTERRUPTED]: "settlementImports.status.interrupted",
  [UploadedFileStatus.DONE]: "settlementImports.status.done",
  [UploadedFileStatus.FAILED]: "settlementImports.status.failed",
};

// An imported file's state, in one colour everywhere — the list, the file's page and the dialog.
export function UploadedFileStatusBadge({ status }: { status: UploadedFileStatus }) {
  const { t } = useTranslation();

  return (
    <Badge colorPalette={COLOR[status]} data-testid={`upload-status-${UploadedFileStatus[status].toLowerCase()}`}>
      {t(LABEL[status])}
    </Badge>
  );
}
