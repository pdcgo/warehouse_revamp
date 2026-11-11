import { useTranslation } from "react-i18next";
import { Badge } from "@chakra-ui/react";

import type { FoundRequestStatus } from "../../../gen/warehouse/inventory/v1/found_request_pb";
import { STATUS } from "./found";

/** A found request's status, in its categorical colour — *Ditarik* when the reporter took it back. */
export function FoundRequestStatusBadge({ status, withdrawn = false }: { status: FoundRequestStatus; withdrawn?: boolean }) {
  const { t } = useTranslation();
  const meta = STATUS[status];

  return (
    <Badge colorPalette={meta.color} data-testid={`found-request-status-${status}`}>
      {withdrawn ? t("foundRequest.status.withdrawn") : t(meta.key)}
    </Badge>
  );
}
