import { Card, Heading, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../features/auth/AuthContext";
import { useTeam } from "../../features/team/TeamContext";

export function HomePage() {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const { current } = useTeam();

  return (
    <Stack gap="section" maxW="lg">
      <Heading size="md">{t("account.signedIn")}</Heading>

      <Card.Root>
        <Card.Body>
          <Stack gap="field">
            <Text data-testid="home-user">
              {t("account.userLabel")} <strong>{identity?.username}</strong>
            </Text>

            {/* The current team IS the authorization scope: its id goes in the body of every
                scoped RPC. */}
            <Text data-testid="home-team">
              {t("account.teamLabel")} <strong>{current?.teamName || "-"}</strong>
              {current ? ` (role ${current.role})` : ""}
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Text color="fg.muted" fontSize="sm">
        {t("account.warehouseNotDesigned")}
      </Text>
    </Stack>
  );
}
