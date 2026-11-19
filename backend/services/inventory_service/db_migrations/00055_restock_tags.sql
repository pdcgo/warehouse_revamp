-- +goose Up
-- +goose StatementBegin

-- RESTOCK TAGS (backlog #87 — docs/business/inventory/restock_decision.md: a-restock-tag-is-system-or-custom,
-- custom-tags-are-shared-system-tags-are-the-admins-and-the-apps, a-restock-problem-is-a-system-tag; the design
-- the-restock-tags-prototype-is-accepted in docs/technical/frontend/restock_decision.md). A restock carries TAGS, and both
-- restock lists filter by them.
--
--   tags          ONE APP-WIDE LIST — every team's, not one per team. A name is unique across it, compared case-insensitively
--                 (the unique index on lower(name)); it is kept trimmed with its inner white space folded to one space (the
--                 CHECK), so "  lebaran   2026" and "Lebaran 2026" are one tag. `type` is 'system' (owned by the system —
--                 made, put on and taken off only by Root / the Administrator and the app's own tasks) or 'custom' (made
--                 freely by any user who may tag). `app_task` names the app's own task that owns a SYSTEM tag; '' otherwise —
--                 unique where set, and only on a system tag.
--   restock_tags  one tag on one restock — the pair is the key, so a tag is on a restock once — with who put it on (an opaque
--                 user_service id; 0 = the app) and when. Deleting a tag takes it off every restock (ON DELETE CASCADE; the
--                 RPC locks the tag row first).
CREATE TABLE tags (
    id                     BIGSERIAL   PRIMARY KEY,
    name                   TEXT        NOT NULL CHECK (
        name <> '' AND char_length(name) <= 60 AND name = btrim(regexp_replace(name, '\s+', ' ', 'g'))
    ),
    type                   TEXT        NOT NULL CHECK (type IN ('system', 'custom')),
    app_task               TEXT        NOT NULL DEFAULT '' CHECK (app_task = '' OR type = 'system'),
    created_by_user_id     BIGINT      NOT NULL DEFAULT 0 CHECK (created_by_user_id >= 0),
    created_by_is_override BOOLEAN     NOT NULL DEFAULT false,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ONE NAME, ONE TAG: the create's ON CONFLICT and the rename's refusal both stand on this index.
CREATE UNIQUE INDEX tags_name_key ON tags (lower(name));

-- The app's own tags are found by their task, never by their name.
CREATE UNIQUE INDEX tags_app_task_key ON tags (app_task) WHERE app_task <> '';

CREATE TABLE restock_tags (
    restock_id           BIGINT      NOT NULL REFERENCES restocks (id) ON DELETE CASCADE,
    tag_id               BIGINT      NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    added_by_user_id     BIGINT      NOT NULL DEFAULT 0 CHECK (added_by_user_id >= 0),
    added_by_is_override BOOLEAN     NOT NULL DEFAULT false,
    added_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (restock_id, tag_id)
);

-- The other side of the key: the list's tag filter from a rare tag, the admins' per-tag count, and the delete's take-off.
CREATE INDEX restock_tags_tag_idx ON restock_tags (tag_id, restock_id);

-- THE APP'S TWO PROBLEM TAGS (a-restock-problem-is-a-system-tag, the owner's "A": one tag per kind) — Terima puts
-- *Barang kurang* on when it records missing units and *Barang rusak* when it records broken ones. Locked for everyone,
-- admins included: never put on or taken off by hand, never renamed or deleted (when one comes off waits on the problem's
-- solution, not decided).
INSERT INTO tags (name, type, app_task) VALUES
    ('Barang kurang', 'system', 'restock.problem.missing'),
    ('Barang rusak', 'system', 'restock.problem.broken');

-- THE RESTOCKS ALREADY COUNTED IN WITH A PROBLEM get the tags Terima would have put on: an accepted restock with a
-- missing row carries *Barang kurang*, one with a broken row *Barang rusak*, put on by the app (0) at its accept. A
-- problem row is written only by Terima, so every such restock is accepted — the status is named anyway.
INSERT INTO restock_tags (restock_id, tag_id, added_by_user_id, added_by_is_override, added_at)
SELECT DISTINCT p.restock_id, t.id, 0, false, COALESCE(r.accepted_at, NOW())
FROM restock_problem_items p
JOIN restocks r ON r.id = p.restock_id
JOIN tags t ON t.app_task = CASE p.problem_type
    WHEN 'missing' THEN 'restock.problem.missing'
    WHEN 'broken' THEN 'restock.problem.broken'
END
WHERE r.status = 'accepted'
  AND p.count > 0
ON CONFLICT (restock_id, tag_id) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE restock_tags;
DROP TABLE tags;

-- +goose StatementEnd
