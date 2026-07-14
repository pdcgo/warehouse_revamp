import type { ReactNode } from "react";
import { useState } from "react";
import { Card, Heading, Stack, Text } from "@chakra-ui/react";
import { PasswordInput } from "../components/PasswordInput";
import { UserItem } from "../components/UserItem";
import { TeamItem } from "../components/TeamItem";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { ShippingSelect } from "../shipping/ShippingSelect";
import { CategorySelect } from "../categories/CategorySelect";

// ComponentsPage is a live gallery of the app's reusable shared components — a place to preview and
// exercise each one in isolation (issue #34). As new shared components land, add a card here.
export function ComponentsPage() {
  const [password, setPassword] = useState("");
  const [courier, setCourier] = useState("");
  const [category, setCategory] = useState(0n);

  return (
    <Stack gap="section" maxW="2xl">
      <Stack gap="1">
        <Heading size="md">Shared components</Heading>
        <Text color="fg.muted">A live gallery of the app's reusable components.</Text>
      </Stack>

      <ComponentCard
        title="PasswordInput"
        description="A password field with a show/hide toggle. Drop-in for any masked input."
      >
        <PasswordInput
          value={password}
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
        />
      </ComponentCard>

      <ComponentCard
        title="ShippingSelect"
        description="Courier picker backed by the shipping catalogue. Emits a courier code."
      >
        <ShippingSelect value={courier} onChange={setCourier} />
        <Text fontSize="xs" color="fg.muted" data-testid="shipping-demo-value">
          Selected code: {courier || "(none)"}
        </Text>
      </ComponentCard>

      <ComponentCard
        title="UserItem"
        description="The shared way to show a user — avatar (or initials), display name, and @username."
      >
        <UserItem user={{ name: "Ada Lovelace", username: "ada", avatarUrl: "" }} />
        <UserItem user={{ name: "", username: "no_name_user", avatarUrl: "" }} />
      </ComponentCard>

      <ComponentCard
        title="TeamItem"
        description="The shared way to show a team — avatar, name, and a type badge coloured per team type."
      >
        <TeamItem team={{ teamName: "Jakarta Warehouse", teamType: TeamType.WAREHOUSE }} />
        <TeamItem team={{ teamName: "Srengat Selling", teamType: TeamType.SELLING }} />
        <TeamItem team={{ teamName: "Root Team", teamType: TeamType.ROOT }} />
      </ComponentCard>

      <ComponentCard
        title="CategorySelect"
        description="Nested category picker over the global taxonomy. Emits a category id (0 = top-level)."
      >
        <CategorySelect value={category} onChange={setCategory} />
        <Text fontSize="xs" color="fg.muted" data-testid="category-demo-value">
          Selected id: {category.toString()}
        </Text>
      </ComponentCard>
    </Stack>
  );
}

function ComponentCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card.Root data-testid={`component-card-${title}`}>
      <Card.Body>
        <Stack gap="card">
          <Stack gap="1">
            <Heading size="sm">{title}</Heading>
            <Text fontSize="sm" color="fg.muted">
              {description}
            </Text>
          </Stack>

          {children}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
