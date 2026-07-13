import {
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  NativeSelect,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useTeam } from "../team/TeamContext";
import { menuFor } from "./nav";

export function Layout() {
  const { identity, logout } = useAuth();
  const { teams, current, selectTeam } = useTeam();

  // THE MENU FOLLOWS THE CURRENT TEAM — its type and your role in it. Switching team switches
  // the whole app's job, and what you are allowed to do in it.
  const menu = menuFor(current?.teamType, current?.role);

  return (
    <Box minH="100dvh">
      <Flex as="header" align="center" gap="section" borderBottomWidth="1px" px="page" py="card">
        <Heading size="sm">warehouse_revamp</Heading>

        <HStack gap="card">
          {menu.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {({ isActive }) => (
                <Text fontWeight={isActive ? "semibold" : "normal"} color={isActive ? "brand.fg" : "fg.muted"}>
                  {item.label}
                </Text>
              )}
            </NavLink>
          ))}
        </HStack>

        <Spacer />

        {teams.length > 0 && (
          <NativeSelect.Root width="220px" size="sm">
            <NativeSelect.Field
              data-testid="team-switcher"
              value={current?.teamId.toString() ?? ""}
              onChange={(e) => selectTeam(BigInt(e.target.value))}
            >
              {teams.map((team) => (
                <option key={team.teamId.toString()} value={team.teamId.toString()}>
                  {/* team_service may be down: TeamAccessList degrades rather than failing, so
                      the name can legitimately be empty. Fall back rather than render blank. */}
                  {team.teamName || `Team #${team.teamId}`}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        )}

        <Text fontSize="sm" color="fg.muted" data-testid="current-user">
          {identity?.username}
        </Text>

        <Button size="xs" variant="outline" onClick={() => void logout()}>
          Sign out
        </Button>
      </Flex>

      <Box as="main" p="page">
        <Outlet />
      </Box>
    </Box>
  );
}
