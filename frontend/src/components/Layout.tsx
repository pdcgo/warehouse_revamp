import { useState } from "react";
import {
  Box,
  Button,
  Flex,
  Icon,
  IconButton,
  NativeSelect,
  Spacer,
  Stack,
  Text,
} from "@chakra-ui/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useTeam } from "../team/TeamContext";
import { Logo, WarehouseMark } from "./Logo";
import { menuFor } from "./nav";

// The app shell: a persistent left sidebar (brand, team switcher, navigation) beside a content
// column with a slim top bar (identity + sign out).
//
// THE MENU FOLLOWS THE CURRENT TEAM — its type and your role in it. Switching team switches the
// whole app's job, and what you are allowed to do in it. (Hiding a menu item is UX only; the
// server's access interceptor is what actually stops a call — never move a check into here.)
export function Layout() {
  const { identity, logout } = useAuth();
  const { teams, current, selectTeam } = useTeam();
  const [collapsed, setCollapsed] = useState(false);

  const menu = menuFor(current?.teamType, current?.role);

  return (
    <Flex minH="100dvh">
      <Flex
        as="nav"
        direction="column"
        gap="section"
        flexShrink={0}
        w={collapsed ? "64px" : "240px"}
        transition="width 0.15s ease"
        borderRightWidth="1px"
        borderColor="border"
        p="card"
      >
        <Box px="2" py="1" overflow="hidden">
          {collapsed ? <WarehouseMark size={26} /> : <Logo size={28} />}
        </Box>

        {teams.length > 0 && !collapsed && (
          <NativeSelect.Root size="sm">
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

        <Stack gap="1" flex="1">
          {menu.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}>
              {({ isActive }) => (
                <Flex
                  align="center"
                  gap="2.5"
                  rounded="md"
                  px="3"
                  py="2"
                  fontSize="sm"
                  fontWeight="medium"
                  justify={collapsed ? "center" : "flex-start"}
                  bg={isActive ? "brand.solid" : "transparent"}
                  color={isActive ? "brand.contrast" : "fg.muted"}
                  _hover={isActive ? undefined : { bg: "brand.subtle", color: "brand.fg" }}
                >
                  <Icon as={item.icon} boxSize="4" flexShrink={0} />
                  {!collapsed && <Text>{item.label}</Text>}
                </Flex>
              )}
            </NavLink>
          ))}
        </Stack>

        <Flex justify={collapsed ? "center" : "flex-end"}>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((v) => !v)}
          >
            <Icon as={collapsed ? PanelLeftOpen : PanelLeftClose} boxSize="4" />
          </IconButton>
        </Flex>
      </Flex>

      <Flex direction="column" flex="1" minW="0">
        <Flex
          as="header"
          align="center"
          gap="section"
          borderBottomWidth="1px"
          borderColor="border"
          px="page"
          py="card"
        >
          <Spacer />

          <Text fontSize="sm" color="fg.muted" data-testid="current-user">
            {identity?.username}
          </Text>

          <Button size="xs" variant="outline" onClick={() => void logout()}>
            Sign out
          </Button>
        </Flex>

        <Box as="main" flex="1" overflow="auto" p="page">
          <Outlet />
        </Box>
      </Flex>
    </Flex>
  );
}
