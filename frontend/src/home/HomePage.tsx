import { Card, Heading, Stack, Text } from "@chakra-ui/react";
import { useAuth } from "../auth/AuthContext";
import { useTeam } from "../team/TeamContext";

export function HomePage() {
  const { identity } = useAuth();
  const { current } = useTeam();

  return (
    <Stack gap="section" maxW="lg">
      <Heading size="md">Signed in</Heading>

      <Card.Root>
        <Card.Body>
          <Stack gap="field">
            <Text data-testid="home-user">
              User: <strong>{identity?.username}</strong>
            </Text>

            {/* The current team IS the authorization scope: its id goes in the body of every
                scoped RPC. */}
            <Text data-testid="home-team">
              Team: <strong>{current?.teamName || "-"}</strong>
              {current ? ` (role ${current.role})` : ""}
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Text color="fg.muted" fontSize="sm">
        The warehouse itself is not designed yet — see plans/plan.md §1.
      </Text>
    </Stack>
  );
}
