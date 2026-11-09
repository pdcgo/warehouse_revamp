import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Button, Icon } from "@chakra-ui/react";
import { ArrowLeft, Eye } from "lucide-react";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { useCanWrite } from "./TeamContext";

// WriteRoute wraps a route that exists only to CHANGE something — a create or edit form, an accept, a count, a
// finalize. While the admin team monitors the team (the-admin-team-monitors-read-only) the screens offer no way in, but
// a URL still does (a bookmark, history, a link pasted in chat); here such a route says it is read-only instead of
// drawing a form whose submit the server would refuse.
//
// It asks canWrite — the one gate — and nothing else; a route that READS stays outside it.
export function WriteRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (useCanWrite()) {
    return <>{children}</>;
  }

  return (
    <Box data-testid="read-only-route">
      <EmptyHint
        icon={Eye}
        title={t("shell.readOnlyTitle")}
        description={t("shell.readOnlyBody")}
        action={
          <Button variant="outline" onClick={() => navigate(-1)}>
            <Icon as={ArrowLeft} boxSize="4" />
            {t("shell.readOnlyBack")}
          </Button>
        }
      />
    </Box>
  );
}
