import { Suspense, useState } from "react";
import {
  Avatar,
  Box,
  Breadcrumb,
  Flex,
  Icon,
  IconButton,
  Menu,
  Portal,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { useTeam } from "../team/TeamContext";
import { LANGUAGES, useLanguage } from "../i18n/language";
import type { Lang } from "../i18n/language";
import { TeamSwitcher } from "../team/TeamSwitcher";
import { Logo, WarehouseMark } from "./Logo";
import { isMenuGroup, menuFor } from "./nav";
import type { MenuItem } from "./nav";

// The app shell: a persistent left sidebar (brand, team switcher, navigation) beside a content
// column with a slim top bar (identity + sign out).
//
// THE MENU FOLLOWS THE CURRENT TEAM — its type and your role in it. Switching team switches the
// whole app's job, and what you are allowed to do in it. (Hiding a menu item is UX only; the
// server's access interceptor is what actually stops a call — never move a check into here.)
export function Layout() {
  const { identity, logout } = useAuth();
  const { current } = useTeam();
  const { lang, setLang } = useLanguage();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const menu = menuFor(current?.teamType, current?.role);

  // Flatten groups to their child links so the breadcrumb can match a sub-menu route too.
  const flatItems: MenuItem[] = menu.flatMap((entry) => (isMenuGroup(entry) ? entry.children : [entry]));

  // The current page's label, derived from the route — drives the top-bar breadcrumb/title.
  const currentLabel =
    flatItems.find((item) =>
      item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to),
    )?.label ?? "";

  // One nav link row — shared by top-level items and (indented) group children.
  const navItem = (item: MenuItem, indent = false) => (
    <NavLink key={item.to} to={item.to} end={item.to === "/"}>
      {({ isActive }) => (
        <Flex
          align="center"
          gap="2.5"
          rounded="md"
          px="3"
          py="2"
          pl={indent && !collapsed ? "9" : "3"}
          fontSize="sm"
          fontWeight="medium"
          justify={collapsed ? "center" : "flex-start"}
          bg={isActive ? "brand.solid" : "transparent"}
          color={isActive ? "brand.contrast" : "fg.muted"}
          _hover={isActive ? undefined : { bg: "brand.subtle", color: "brand.fg" }}
        >
          <Icon as={item.icon} boxSize="4" flexShrink={0} />
          {!collapsed && <Text>{t(item.label)}</Text>}
        </Flex>
      )}
    </NavLink>
  );

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
        <Box px="2" py="1" overflow="hidden" color="brand.solid">
          {collapsed ? <WarehouseMark size={26} /> : <Logo size={28} />}
        </Box>

        <TeamSwitcher collapsed={collapsed} />

        <Stack gap="1" flex="1">
          {menu.map((entry) =>
            isMenuGroup(entry) ? (
              <Stack key={entry.label} gap="1" data-testid={`nav-group-${entry.label}`}>
                {/* Section header (not a link) with the group's children indented beneath it. */}
                <Flex
                  align="center"
                  gap="2.5"
                  px="3"
                  py="2"
                  fontSize="xs"
                  fontWeight="semibold"
                  textTransform="uppercase"
                  color="fg.muted"
                  justify={collapsed ? "center" : "flex-start"}
                >
                  <Icon as={entry.icon} boxSize="4" flexShrink={0} />
                  {!collapsed && <Text>{t(entry.label)}</Text>}
                </Flex>
                {entry.children.map((child) => navItem(child, true))}
              </Stack>
            ) : (
              navItem(entry)
            ),
          )}
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
          <Breadcrumb.Root size="lg">
            <Breadcrumb.List>
              <Breadcrumb.Item>
                <Breadcrumb.CurrentLink fontWeight="semibold" color="fg">
                  {currentLabel ? t(currentLabel) : ""}
                </Breadcrumb.CurrentLink>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb.Root>

          <Spacer />

          <Menu.Root positioning={{ placement: "bottom-end" }}>
            <Menu.Trigger asChild>
              <Flex
                as="button"
                data-testid="user-menu"
                align="center"
                gap="2"
                rounded="md"
                px="2"
                py="1"
                cursor="pointer"
                _hover={{ bg: "bg.muted" }}
              >
                <Avatar.Root size="xs" colorPalette="brand">
                  <Avatar.Fallback name={identity?.username} />
                </Avatar.Root>

                <Text fontSize="sm" color="fg.muted" data-testid="current-user">
                  {identity?.username}
                </Text>

                <Icon as={ChevronDown} boxSize="4" color="fg.muted" flexShrink={0} />
              </Flex>
            </Menu.Trigger>

            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="200px">
                  {/* Language switcher (#93). Persists the choice and sets the page language; the
                      UI-string translation itself is the i18n effort tracked in #65. */}
                  <Menu.RadioItemGroup value={lang} onValueChange={(e) => setLang(e.value as Lang)}>
                    <Menu.ItemGroupLabel>{t("menu.language")}</Menu.ItemGroupLabel>
                    {LANGUAGES.map((l) => (
                      <Menu.RadioItem key={l.value} value={l.value} data-testid={`lang-${l.value}`}>
                        {l.label}
                        <Menu.ItemIndicator />
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioItemGroup>

                  <Menu.Separator />

                  <Menu.Item
                    value="sign-out"
                    color="fg.error"
                    data-testid="sign-out"
                    onClick={() => void logout()}
                  >
                    <Icon as={LogOut} boxSize="4" />
                    {t("menu.signOut")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Flex>

        <Box as="main" flex="1" overflow="auto" p="page">
          {/* Each route's page is code-split (React.lazy in router.tsx); this boundary shows a
              spinner for the brief moment its chunk is fetched. */}
          <Suspense fallback={<Spinner colorPalette="brand" />}>
            <Outlet />
          </Suspense>
        </Box>
      </Flex>
    </Flex>
  );
}
