import type { ReactNode } from "react";
import { useState } from "react";
import { Card, Flex, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { PasswordInput } from "../components/PasswordInput";
import { UserItem } from "../components/UserItem";
import { TeamItem } from "../components/TeamItem";
import { TeamTypeSelect } from "../components/TeamTypeSelect";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { ShippingSelect } from "../shipping/ShippingSelect";
import { CategorySelect } from "../categories/CategorySelect";

// Each shared component is one entry: a stable id (also the scroll anchor), a title, a description,
// and a live render. The left list and the cards are both driven from this array, so they can't
// drift.
interface Entry {
  id: string;
  title: string;
  description: string;
  render: () => ReactNode;
}

function PasswordDemo() {
  const [value, setValue] = useState("");

  return (
    <PasswordInput value={value} placeholder="Password" onChange={(e) => setValue(e.target.value)} />
  );
}

function ShippingDemo() {
  const [code, setCode] = useState("");

  return (
    <>
      <ShippingSelect value={code} onChange={setCode} />
      <Text fontSize="xs" color="fg.muted">
        Selected code: {code || "(none)"}
      </Text>
    </>
  );
}

function CategoryDemo() {
  const [id, setId] = useState(0n);

  return (
    <>
      <CategorySelect value={id} onChange={setId} />
      <Text fontSize="xs" color="fg.muted">
        Selected id: {id.toString()}
      </Text>
    </>
  );
}

function TeamTypeDemo() {
  const [type, setType] = useState<TeamType>(TeamType.WAREHOUSE);

  return (
    <>
      <TeamTypeSelect value={type} onChange={setType} />
      <Text fontSize="xs" color="fg.muted">
        Selected type: {TeamType[type]}
      </Text>
    </>
  );
}

const ENTRIES: Entry[] = [
  {
    id: "password-input",
    title: "PasswordInput",
    description: "A password field with a show/hide toggle. Drop-in for any masked input.",
    render: () => <PasswordDemo />,
  },
  {
    id: "user-item",
    title: "UserItem",
    description: "The shared way to show a user — avatar (or initials), display name, and @username.",
    render: () => (
      <>
        <UserItem user={{ name: "Ada Lovelace", username: "ada", avatarUrl: "" }} />
        <UserItem user={{ name: "", username: "no_name_user", avatarUrl: "" }} />
      </>
    ),
  },
  {
    id: "team-item",
    title: "TeamItem",
    description: "The shared way to show a team — avatar, name, and a type badge coloured per type.",
    render: () => (
      <>
        <TeamItem team={{ teamName: "Jakarta Warehouse", teamType: TeamType.WAREHOUSE }} />
        <TeamItem team={{ teamName: "Srengat Selling", teamType: TeamType.SELLING }} />
        <TeamItem team={{ teamName: "Root Team", teamType: TeamType.ROOT }} />
      </>
    ),
  },
  {
    id: "shipping-select",
    title: "ShippingSelect",
    description: "Courier picker backed by the shipping catalogue. Emits a courier code.",
    render: () => <ShippingDemo />,
  },
  {
    id: "category-select",
    title: "CategorySelect",
    description: "Nested category picker over the global taxonomy. Emits a category id (0 = top-level).",
    render: () => <CategoryDemo />,
  },
  {
    id: "team-type-select",
    title: "TeamTypeSelect",
    description: "Team-type picker (Chakra Select). Emits a TeamType; defaults to the creatable set.",
    render: () => <TeamTypeDemo />,
  },
];

// ComponentsPage is a live gallery of the app's reusable shared components (issue #34). A left list
// navigates between them; each card is anchored so the link scrolls straight to it.
export function ComponentsPage() {
  return (
    <Flex gap="section" align="start">
      <Stack
        as="nav"
        gap="1"
        w="180px"
        flexShrink={0}
        position="sticky"
        top="page"
        display={{ base: "none", md: "flex" }}
      >
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted" textTransform="uppercase" mb="1">
          Components
        </Text>
        {ENTRIES.map((entry) => (
          <Link
            key={entry.id}
            href={`#${entry.id}`}
            fontSize="sm"
            color="fg.muted"
            rounded="md"
            px="2"
            py="1.5"
            _hover={{ bg: "brand.subtle", color: "brand.fg", textDecoration: "none" }}
          >
            {entry.title}
          </Link>
        ))}
      </Stack>

      <Stack gap="section" flex="1" minW="0" maxW="2xl">
        <Stack gap="1">
          <Heading size="md">Shared components</Heading>
          <Text color="fg.muted">A live gallery of the app's reusable components.</Text>
        </Stack>

        {ENTRIES.map((entry) => (
          <Card.Root key={entry.id} id={entry.id} scrollMarginTop="page">
            <Card.Body>
              <Stack gap="card">
                <Stack gap="1">
                  <Heading size="sm">{entry.title}</Heading>
                  <Text fontSize="sm" color="fg.muted">
                    {entry.description}
                  </Text>
                </Stack>

                {entry.render()}
              </Stack>
            </Card.Body>
          </Card.Root>
        ))}
      </Stack>
    </Flex>
  );
}
