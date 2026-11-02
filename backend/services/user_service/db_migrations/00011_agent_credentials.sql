-- +goose Up
-- +goose StatementBegin

-- AN AI AGENT'S OWN CREDENTIAL (an-agent-gets-its-own-team-credential), and the OAuth that mints it
-- (our-server-hosts-the-mcp). An agent connects by URL; its OAuth sends the person to our connect page, which names
-- the connection and picks the team; the agent trades the one-time code for a credential of its own — never the
-- person's password or session token, which carry every write an agent may not make (an-agent-only-reads-for-now).

-- The agents that registered themselves (RFC 7591 dynamic client registration). A public client: no secret, PKCE
-- instead. The redirect a code is sent to must be one of these, exactly.
CREATE TABLE agent_oauth_clients (
    id            BIGSERIAL   PRIMARY KEY,
    client_id     TEXT        NOT NULL,
    -- What the agent calls itself — "ChatGPT", "Claude" — shown on the connect page and beside each connection.
    client_name   TEXT        NOT NULL DEFAULT '',
    -- A JSON array of the exact redirect URIs the agent registered.
    redirect_uris JSONB       NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agent_oauth_clients_client_id_unique UNIQUE (client_id)
);

-- The one-time codes the connect page mints. Short-lived, used once: the token exchange marks it used in the same
-- statement that reads it, so two exchanges of one code mint one credential.
CREATE TABLE agent_oauth_codes (
    id             BIGSERIAL   PRIMARY KEY,
    -- SHA-256 of the code, hex. The code itself is never stored.
    code_hash      TEXT        NOT NULL,
    client_id      TEXT        NOT NULL,
    user_id        BIGINT      NOT NULL REFERENCES users (id),
    -- The team picked at the connect page — opaque team_service id, no FK. 0 = every team (root's bypass).
    team_id        BIGINT      NOT NULL,
    name           TEXT        NOT NULL,
    redirect_uri   TEXT        NOT NULL,
    -- PKCE S256: base64url(SHA-256(verifier)).
    code_challenge TEXT        NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    used_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agent_oauth_codes_code_hash_unique UNIQUE (code_hash)
);

-- The credentials. Read-only, one team (or every team for root), 90 days, revoked one by one.
CREATE TABLE agent_credentials (
    id           BIGSERIAL   PRIMARY KEY,
    -- SHA-256 of the bearer, hex. The bearer itself is shown to nobody and stored nowhere.
    token_hash   TEXT        NOT NULL,
    user_id      BIGINT      NOT NULL REFERENCES users (id),
    -- Opaque team_service id, no FK. 0 = every team — only ever minted for root or the root team's administrator.
    team_id      BIGINT      NOT NULL,
    name         TEXT        NOT NULL CHECK (name <> ''),
    client_id    TEXT        NOT NULL,
    client_name  TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    -- Stamped at most once a minute — a write per agent call would be a write per read.
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    CONSTRAINT agent_credentials_token_hash_unique UNIQUE (token_hash)
);

-- /profile's list — a person's connections, newest first — and the owner's: every connection reading a team.
CREATE INDEX agent_credentials_user_idx ON agent_credentials (user_id, id DESC);
CREATE INDEX agent_credentials_team_idx ON agent_credentials (team_id, id DESC);

-- WHO MAY CONNECT (the-owner-decides-who-connects-an-agent): the owner and admin always; CS and staff only once the
-- owner turns this on. No row reads as off.
CREATE TABLE team_agent_policies (
    -- Opaque team_service id, no FK.
    team_id             BIGINT      PRIMARY KEY,
    members_may_connect BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_by_user_id  BIGINT      REFERENCES users (id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE team_agent_policies;
DROP TABLE agent_credentials;
DROP TABLE agent_oauth_codes;
DROP TABLE agent_oauth_clients;
-- +goose StatementEnd
