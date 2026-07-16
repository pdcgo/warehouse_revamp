import type { ReactNode } from "react";
import { useState } from "react";
import { Card, Flex, Heading, Link, Stack, Text } from "@chakra-ui/react";
// Each curated component exports its OWN description (a rule — see CLAUDE.md). The gallery reads
// them here so it is documentation generated from the components themselves, not a parallel list
// that can drift.
import { PasswordInput, description as passwordInputDescription } from "../components/PasswordInput";
import { Pagination, description as paginationDescription } from "../components/Pagination";
import { UserItem, description as userItemDescription } from "../components/UserItem";
import { TeamItem, description as teamItemDescription } from "../components/TeamItem";
import { TeamTypeSelect, description as teamTypeSelectDescription } from "../components/TeamTypeSelect";
import { TeamSelect, description as teamSelectDescription } from "../components/TeamSelect";
import { UserSelect, description as userSelectDescription } from "../components/UserSelect";
import { RoleSelect, description as roleSelectDescription } from "../components/RoleSelect";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { roleLabel } from "../lib/roles";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { ShippingSelect, description as shippingSelectDescription } from "../shipping/ShippingSelect";
import { CategorySelect, description as categorySelectDescription } from "../categories/CategorySelect";
import {
  MarketplaceSelect,
  marketplaceLabel,
  description as marketplaceSelectDescription,
} from "../components/MarketplaceSelect";
import { MarketplaceBadge, description as marketplaceBadgeDescription } from "../components/MarketplaceBadge";
import { OrderStatusBadge, description as orderStatusBadgeDescription } from "../components/OrderStatusBadge";
import { ShopSelect, description as shopSelectDescription } from "../components/ShopSelect";
import {
  ProductSelect,
  description as productSelectDescription,
  type PickedProduct,
} from "../components/ProductSelect";
import { Marketplace } from "../gen/warehouse/selling/v1/selling_pb";
import { OrderStatus } from "../gen/warehouse/selling/v1/order_pb";
import { useTeam } from "../team/TeamContext";

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

function PaginationDemo() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  return (
    <Stack gap="1">
      <Pagination
        count={45}
        pageSize={pageSize}
        page={page}
        onPageChange={setPage}
        pageSizeOptions={[10, 20, 50]}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
      <Text fontSize="xs" color="fg.muted">
        45 items · {pageSize} per page · page {page}
      </Text>
    </Stack>
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
  const [leafId, setLeafId] = useState(0n);

  return (
    <Stack gap="card">
      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          Any category selectable (default)
        </Text>
        <CategorySelect value={id} onChange={setId} />
        <Text fontSize="xs" color="fg.muted">
          Selected id: {id.toString()}
        </Text>
      </Stack>

      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          End categories only — <code>leafOnly</code>
        </Text>
        <CategorySelect value={leafId} onChange={setLeafId} leafOnly />
        <Text fontSize="xs" color="fg.muted">
          Selected id: {leafId.toString()}
        </Text>
      </Stack>
    </Stack>
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

function TeamSelectDemo() {
  const [id, setId] = useState(0n);

  return (
    <>
      <TeamSelect value={id || undefined} onChange={setId} />
      <Text fontSize="xs" color="fg.muted">
        Selected team id: {id.toString()}
      </Text>
    </>
  );
}

function UserSelectDemo() {
  const [all, setAll] = useState(0n);
  const [scoped, setScoped] = useState(0n);
  const { current } = useTeam();

  return (
    <Stack gap="card">
      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          All users (default)
        </Text>
        <UserSelect value={all || undefined} onChange={setAll} />
        <Text fontSize="xs" color="fg.muted">
          Selected user id: {all.toString()}
        </Text>
      </Stack>

      <Stack gap="1">
        <Text fontSize="xs" fontWeight="medium">
          Scoped to the current team{current ? ` (${current.teamName || `#${current.teamId}`})` : ""}
        </Text>
        <UserSelect
          value={scoped || undefined}
          onChange={setScoped}
          teamId={current?.teamId}
          placeholder="Search this team's members"
        />
        <Text fontSize="xs" color="fg.muted">
          Selected user id: {scoped.toString()}
        </Text>
      </Stack>
    </Stack>
  );
}

function RoleSelectDemo() {
  const [role, setRole] = useState<Role>(Role.UNSPECIFIED);

  return (
    <>
      <RoleSelect value={role || undefined} onChange={setRole} />
      <Text fontSize="xs" color="fg.muted">
        Selected role: {role ? roleLabel(role) : "(none)"}
      </Text>
    </>
  );
}

function MarketplaceDemo() {
  const [m, setM] = useState<Marketplace>(Marketplace.UNSPECIFIED);

  return (
    <>
      <MarketplaceSelect value={m} onChange={setM} />
      <Text fontSize="xs" color="fg.muted">
        Selected: {m ? marketplaceLabel(m) : "(none)"}
      </Text>
    </>
  );
}

function ShopSelectDemo() {
  const [id, setId] = useState(0n);
  const { current } = useTeam();

  return (
    <>
      <ShopSelect teamId={current?.teamId ?? 0n} value={id} onChange={setId} />
      <Text fontSize="xs" color="fg.muted">
        Selected shop id: {id.toString()}
        {current ? "" : " — select a selling team to load shops"}
      </Text>
    </>
  );
}

function ProductSelectDemo() {
  const [picked, setPicked] = useState<PickedProduct | null>(null);
  const { current } = useTeam();

  return (
    <>
      <ProductSelect
        teamId={current?.teamId ?? 0n}
        value={picked?.id}
        onChange={setPicked}
      />
      <Text fontSize="xs" color="fg.muted">
        Picked: {picked ? `${picked.sku} — ${picked.name}` : "(none)"}
        {current ? "" : " — select a team to search its catalogue"}
      </Text>
    </>
  );
}

const ENTRIES: Entry[] = [
  {
    id: "password-input",
    title: "PasswordInput",
    description: passwordInputDescription,
    render: () => <PasswordDemo />,
  },
  {
    id: "pagination",
    title: "Pagination",
    description: paginationDescription,
    render: () => <PaginationDemo />,
  },
  {
    id: "user-item",
    title: "UserItem",
    description: userItemDescription,
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
    description: teamItemDescription,
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
    description: shippingSelectDescription,
    render: () => <ShippingDemo />,
  },
  {
    id: "category-select",
    title: "CategorySelect",
    description: categorySelectDescription,
    render: () => <CategoryDemo />,
  },
  {
    id: "team-type-select",
    title: "TeamTypeSelect",
    description: teamTypeSelectDescription,
    render: () => <TeamTypeDemo />,
  },
  {
    id: "marketplace-select",
    title: "MarketplaceSelect",
    description: marketplaceSelectDescription,
    render: () => <MarketplaceDemo />,
  },
  {
    id: "marketplace-badge",
    title: "MarketplaceBadge",
    description: marketplaceBadgeDescription,
    render: () => (
      <Flex gap="2" wrap="wrap">
        {[
          Marketplace.SHOPEE,
          Marketplace.TOKOPEDIA,
          Marketplace.LAZADA,
          Marketplace.TIKTOK,
          Marketplace.BLIBLI,
          Marketplace.BUKALAPAK,
          Marketplace.OTHER,
        ].map((m) => (
          <MarketplaceBadge key={m} marketplace={m} />
        ))}
      </Flex>
    ),
  },
  {
    id: "order-status-badge",
    title: "OrderStatusBadge",
    description: orderStatusBadgeDescription,
    render: () => (
      <Flex gap="2" wrap="wrap">
        {[OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.CANCELLED].map((s) => (
          <OrderStatusBadge key={s} status={s} />
        ))}
      </Flex>
    ),
  },
  {
    id: "shop-select",
    title: "ShopSelect",
    description: shopSelectDescription,
    render: () => <ShopSelectDemo />,
  },
  {
    id: "product-select",
    title: "ProductSelect",
    description: productSelectDescription,
    render: () => <ProductSelectDemo />,
  },
  {
    id: "team-select",
    title: "TeamSelect",
    description: teamSelectDescription,
    render: () => <TeamSelectDemo />,
  },
  {
    id: "user-select",
    title: "UserSelect",
    description: userSelectDescription,
    render: () => <UserSelectDemo />,
  },
  {
    id: "role-select",
    title: "RoleSelect",
    description: roleSelectDescription,
    render: () => <RoleSelectDemo />,
  },
];

// ComponentsPage is a live gallery of the app's reusable shared components (issue #34). A left list
// navigates between them; each card is anchored so the link scrolls straight to it.
export function ComponentsPage() {
  return (
    <Flex gap="section" align="start" data-testid="components-page">
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
