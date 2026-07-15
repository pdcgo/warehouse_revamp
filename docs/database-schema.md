# Database schema

The authoritative schema is the goose migrations under
`backend/services/<service>/db_migrations/` — this document mirrors them for humans. **Keep it in
sync: any migration that changes the schema updates this file in the same commit** (HARD RULE 3).

Each service owns its own tables. **There are no cross-service foreign keys** — a service refers to
another's rows by an *opaque id* it never joins on (it resolves them over RPC, e.g.
`team_service.TeamByIds`). Those logical links are described in the prose and are not enforced by
the database.

---

## team_service

`backend/services/team_service/db_migrations/`

```mermaid
erDiagram
    teams ||--o| team_infos : "has 1 to 1"

    teams {
        bigserial   id          PK
        text        type        "root admin warehouse or selling"
        text        name        "required"
        text        team_code   UK "required unique"
        text        description
        text        image_url   "compact team picture, empty if none"
        boolean     deleted     "soft delete"
        timestamptz created_at
        timestamptz updated_at
    }

    team_infos {
        bigserial   id                  PK
        bigint      team_id             FK "unique, on delete cascade"
        bigint      return_warehouse_id "nullable opaque cross-service id"
        bigint      return_user_id      "nullable opaque cross-service id"
        text        contact_number
        text        bank_type
        text        bank_owner_name
        text        bank_account_number
        timestamptz created_at
        timestamptz updated_at
    }
```

- **`teams`** — one row per team (a warehouse *is* a team; see `plans/team_service/`). Root-ness is
  structural: `CHECK ((type = 'root') = (id = 1))` ties `id = 1` and `type = 'root'` together so the
  hardcoded root-team scope in the access interceptor can never drift from the data. Indexes:
  `UNIQUE (team_code)`, and a partial `(type) WHERE deleted = FALSE`.
- **`team_infos`** — 1:1 with `teams` (`UNIQUE (team_id)`, which is what makes `TeamInfoUpdate` a
  real `ON CONFLICT` upsert). `return_warehouse_id` / `return_user_id` are opaque ids owned by other
  services — no FK is possible across the service boundary.

---

## user_service

`backend/services/user_service/db_migrations/`

```mermaid
erDiagram
    users ||--o{ user_team_roles : "member of"

    users {
        bigserial   id                  PK
        text        name
        text        username            UK "unique on lower, required"
        text        password            "bcrypt hash, empty means cannot log in"
        text        email               UK "unique on lower when set"
        text        phone_number
        boolean     is_suspended        "default false"
        text        avatar_url          "profile picture thumbnail url"
        timestamptz last_password_reset "nullable"
        timestamptz created_at
        timestamptz updated_at
    }

    user_team_roles {
        bigserial   id         PK
        bigint      team_id    "opaque cross-service id, no FK to teams"
        bigint      user_id    FK "on delete cascade"
        bigint      role       "role_base.v1.Role enum number"
        text        alias
        timestamptz created_at
        timestamptz updated_at
    }
```

- **`users`** — the identity table. An empty `password` is a deliberate "cannot log in" marker
  (bcrypt never matches an empty hash), used by the seeded root account until a password is set.
  Case-insensitive uniqueness on both `username` and (non-empty) `email`.
- **`user_team_roles`** — a user's role within a team. `role` stores the raw proto `Role` enum
  *number* (not a Postgres enum — proto enums are open). `UNIQUE (team_id, user_id)` is load-bearing:
  the authorization read takes one row, and it is what makes `TeamUserUpdate` an upsert. `team_id`
  is opaque — **no FK to `team_service.teams`** (that would couple the two services' databases);
  team display data is resolved over RPC, never joined.

---

## shipping_service

`backend/services/shipping_service/db_migrations/`

```mermaid
erDiagram
    shippings {
        bigserial   id         PK
        text        code       UK "required unique, stable machine key"
        text        name       "required, display label"
        boolean     active     "default true"
        timestamptz created_at
        timestamptz updated_at
    }
```

- **`shippings`** — the courier catalogue (JNE, J&T, SiCepat, …), seeded by the migration as stable
  reference data, and curated by root/admin. `code` is unique and is what a shipment stores;
  `active = false` retires a courier without deleting it. No relations — it stands alone.

---

## product_service

`backend/services/product_service/db_migrations/`

```mermaid
erDiagram
    products {
        bigserial   id          PK
        bigint      team_id     "owning team, opaque cross-service id, no FK"
        text        sku         "required, unique per team among active"
        text        name        "required"
        text        description
        boolean     deleted     "soft delete"
        timestamptz created_at
        timestamptz updated_at
    }
```

- **`products`** — a team's catalogue items. Every RPC is team-scoped (`team_id` carries
  `use_scope`), so a product is only ever reachable within its owning team. `sku` is unique per team
  **among active products only** (`UNIQUE (team_id, sku) WHERE deleted = FALSE`), so a soft-deleted
  product frees its SKU for reuse and two teams may share a SKU. `team_id` is opaque — no FK to
  `team_service.teams`.

---

## category_service

`backend/services/category_service/db_migrations/`

```mermaid
erDiagram
    categories ||--o{ categories : "parent_id self-referential"

    categories {
        bigserial   id          PK
        text        name        "required, unique per parent among active"
        bigint      parent_id   FK "nullable self-referential, null means top-level"
        boolean     deleted     "soft delete"
        timestamptz created_at
        timestamptz updated_at
    }
```

- **`categories`** — a **global**, nested product-category taxonomy. Unlike `products`, it is **not
  team-scoped** (there is no `team_id`): root/admin curate one shared tree and every authenticated
  user reads it. `parent_id` is a **self-referential FK** to `categories(id)` — `NULL` marks a
  top-level category — so the table is a single tree the client assembles from the flat list. `name`
  is unique among **active** siblings (`UNIQUE (COALESCE(parent_id, 0), name) WHERE deleted = FALSE`,
  which folds the NULL top-level parent into one bucket), so a soft delete frees the name for reuse.
  A category with active children cannot be deleted.

---

## document_service

`backend/services/document_service/db_migrations/`

```mermaid
erDiagram
    documents {
        text        id            PK "uuid"
        bigint      team_id       "owning team, opaque cross-service id, no FK"
        text        resource_type "general or profile_picture"
        text        object_key    "storage path, incoming then assets on confirm"
        text        mime_type
        bigint      size_bytes
        text        filename
        bigint      created_by_id "uploader, best-effort audit"
        text        status        "pending or active"
        text        public_url    "public resource types only"
        text        thumbnail_key "generated thumbnail path for images"
        text        thumbnail_url "public thumbnail url for public images"
        timestamptz created_at
        timestamptz updated_at
    }
```

- **`documents`** — metadata for one stored file; the bytes live in object storage, not the DB.
  Team-scoped (`team_id` opaque, no FK). `status` goes `pending` → `active` on ConfirmUpload, which
  also moves `object_key` from the `incoming/` prefix to `assets/`. `public_url`/`thumbnail_url` are
  set only for public resource types (currently `profile_picture`); an image upload also gets a
  generated thumbnail.

---

## Cross-service links (logical, not enforced)

```mermaid
erDiagram
    teams ||--o{ user_team_roles : "team_id, opaque via RPC"
    teams ||--o{ products : "team_id, opaque via RPC"
    teams ||--o{ documents : "team_id, opaque via RPC"
```

`user_team_roles.team_id`, `products.team_id`, `documents.team_id`,
`team_infos.return_warehouse_id`, and `team_infos.return_user_id` point at rows owned by other
services. They carry no database foreign key by design (HARD RULE 3 — services stay independent);
the owning service resolves them over Connect RPC.
