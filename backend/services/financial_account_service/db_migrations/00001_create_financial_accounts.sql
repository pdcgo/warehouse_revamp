-- +goose Up
-- +goose StatementBegin

-- The money a team actually HOLDS — docs/business/financial_account/context_decision.md.
--
-- `financial_accounts` is the ledger's STATE and `financial_account_logs` its LOG: a balance moves only
-- with a log row, in the same transaction (the-accounts-are-one-ledger).
--
-- ⚠ MONEY IS NUMERIC. The wire is `double` (rupiah-is-floating-point); the database holds the exact value
-- and every figure is rounded to whole rupiah as it posts, so a balance compares exactly against zero and
-- against the bank's figure. Two places are kept so a fractional fee one day needs no migration.
CREATE TABLE financial_accounts (
    id             BIGSERIAL     PRIMARY KEY,
    team_id        BIGINT        NOT NULL,
    -- wallet · bank_account · cash · unknown — picked apart from provider (type-and-provider-are-picked-apart).
    type           TEXT          NOT NULL,
    -- cash · bca · bni · jago · shopeepay · unknown (provider-replaces-account-type).
    provider       TEXT          NOT NULL,
    -- active · archived — archived only at a zero balance (an-account-is-archived-only-at-zero).
    status         TEXT          NOT NULL DEFAULT 'active',
    -- A bank number or a wallet's phone. '' for a cash box and an unknown account.
    account_number TEXT          NOT NULL DEFAULT '',
    name           TEXT          NOT NULL,
    holder_name    TEXT          NOT NULL DEFAULT '',
    description    TEXT          NOT NULL DEFAULT '',
    -- Moves ONLY with a log row. May go below zero (below-zero-is-warned-never-refused).
    balance        NUMERIC(20,2) NOT NULL DEFAULT 0,
    -- The last reconcile — "last checked". NULL = never.
    reconciled_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT financial_accounts_type_known CHECK (type IN ('wallet', 'bank_account', 'cash', 'unknown')),
    CONSTRAINT financial_accounts_provider_known CHECK (provider IN ('cash', 'bca', 'bni', 'jago', 'shopeepay', 'unknown')),
    CONSTRAINT financial_accounts_status_known CHECK (status IN ('active', 'archived')),
    CONSTRAINT financial_accounts_name_present CHECK (name <> '')
);

-- ONE REAL ACCOUNT, ONE ROW (a-real-account-is-recorded-once) — a provider and its number across ALL teams,
-- archived included. Partial: a cash box and an unknown account carry no number and are exempt.
CREATE UNIQUE INDEX financial_accounts_provider_number_unique
    ON financial_accounts (provider, account_number) WHERE account_number <> '';

-- A name is unique in the team, case-blind — a picker never shows two of the same.
CREATE UNIQUE INDEX financial_accounts_team_name_unique ON financial_accounts (team_id, lower(name));

-- The accounts page and every picker: a team's accounts, active first.
CREATE INDEX financial_accounts_team_status_idx ON financial_accounts (team_id, status);

-- The log. Append-only — a mistake is corrected by a further row.
CREATE TABLE financial_account_logs (
    id                 BIGSERIAL     PRIMARY KEY,
    team_id            BIGINT        NOT NULL,
    -- The scope: balance_after runs per account (every-log-row-names-its-account).
    account_id         BIGINT        NOT NULL REFERENCES financial_accounts (id),
    change_type        TEXT          NOT NULL,
    -- Signed — positive is money INTO the account.
    change             NUMERIC(20,2) NOT NULL,
    -- The previous row's plus this one's change, in ENTRY order (the-log-says-balance-after).
    balance_after      NUMERIC(20,2) NOT NULL,
    -- The cause, in words (the-description-names-the-cause) — no source id, no reversal flag.
    description        TEXT          NOT NULL DEFAULT '',
    -- 0 for a row a listener posted with no person behind it.
    actor_id           BIGINT        NOT NULL DEFAULT 0,
    -- When the money MOVED (the-log-keeps-the-day-the-money-moved). The analytics day is this, in Jakarta.
    occurred_at        TIMESTAMPTZ   NOT NULL,
    -- Both legs of one transfer share it. 0 for a single-leg row.
    group_id           BIGINT        NOT NULL DEFAULT 0,
    -- The other account of a transfer. 0 otherwise.
    counter_account_id BIGINT        NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT financial_account_logs_type_known CHECK (change_type IN (
        'expense', 'ads_expense', 'adjustment', 'withdrawal', 'restock',
        'opening_balance', 'transfer', 'team_payment', 'capital'
    ))
);

-- One account's statement, newest first — and the previous row a post reads balance_after from.
CREATE INDEX financial_account_logs_account_id_idx ON financial_account_logs (account_id, id);

-- Both legs of one act share a group id from here.
CREATE SEQUENCE financial_account_log_groups;

-- Which account a shop WITHDRAWS INTO (a-shop-names-the-account-it-withdraws-into). shop_id is unique: a
-- shop names one account (a-shop-has-one-account), an account takes many shops.
CREATE TABLE shop_accounts (
    id         BIGSERIAL   PRIMARY KEY,
    team_id    BIGINT      NOT NULL,
    shop_id    BIGINT      NOT NULL,
    account_id BIGINT      NOT NULL REFERENCES financial_accounts (id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX shop_accounts_shop_unique ON shop_accounts (shop_id);
CREATE INDEX shop_accounts_account_idx ON shop_accounts (account_id);

-- The accounts that PAY FOR OPERATIONS — a restock's Paid from picks among them
-- (operational-accounts-pay-for-operations). account_id is unique: an account is marked once.
CREATE TABLE operational_accounts (
    id         BIGSERIAL   PRIMARY KEY,
    team_id    BIGINT      NOT NULL,
    account_id BIGINT      NOT NULL REFERENCES financial_accounts (id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX operational_accounts_account_unique ON operational_accounts (account_id);

-- THE ANALYTICS' SMALLEST GRAIN — one row per account per day (the-daily-row-is-one-account-one-day).
--
-- ⚠ WRITTEN IN THE LOG ROW's OWN TRANSACTION (the-daily-row-is-written-with-the-log-row): the day's row is
-- upserted and every later day's balances shifted beside the log insert, so a report is never behind the
-- balance and there is no event table, lock or replay. A day with no movement has no row; a balance is read
-- from the last row at or before the date.
CREATE TABLE financial_account_daily_reports (
    id              BIGSERIAL     PRIMARY KEY,
    -- The Jakarta day of the rows' occurred_at (a-row-counts-on-the-day-the-money-moved).
    day             DATE          NOT NULL,
    account_id      BIGINT        NOT NULL,
    team_id         BIGINT        NOT NULL,

    -- One signed sum per change type, positive into the account.
    expense         NUMERIC(20,2) NOT NULL DEFAULT 0,
    ads_expense     NUMERIC(20,2) NOT NULL DEFAULT 0,
    adjustment      NUMERIC(20,2) NOT NULL DEFAULT 0,
    withdrawal      NUMERIC(20,2) NOT NULL DEFAULT 0,
    restock         NUMERIC(20,2) NOT NULL DEFAULT 0,
    opening_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
    transfer        NUMERIC(20,2) NOT NULL DEFAULT 0,
    team_payment    NUMERIC(20,2) NOT NULL DEFAULT 0,
    capital         NUMERIC(20,2) NOT NULL DEFAULT 0,

    -- The day's net — close_balance − open_balance.
    change          NUMERIC(20,2) NOT NULL DEFAULT 0,
    -- The account's balance at the day's two edges, stored and SHIFTED by a late row, never recomputed.
    open_balance    NUMERIC(20,2) NOT NULL DEFAULT 0,
    close_balance   NUMERIC(20,2) NOT NULL DEFAULT 0,

    last_updated    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- (account, day): the upsert's conflict target, the previous-day lookup and the later-day shift.
CREATE UNIQUE INDEX financial_account_daily_reports_account_day_unique
    ON financial_account_daily_reports (account_id, day);
-- A team's series and its rankings.
CREATE INDEX financial_account_daily_reports_team_day_idx ON financial_account_daily_reports (team_id, day);

-- THE LISTENER's CLAIMS — one row per event already posted (san_event.NewDedup's shape). A redelivered
-- withdrawal posts once (one-contract-for-both-handler-types).
CREATE TABLE financial_account_event_logs (
    event_id         TEXT        PRIMARY KEY,
    occurred_at_unix BIGINT      NOT NULL,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX financial_account_event_logs_received_idx ON financial_account_event_logs (received_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE financial_account_event_logs;
DROP TABLE financial_account_daily_reports;
DROP TABLE operational_accounts;
DROP TABLE shop_accounts;
DROP SEQUENCE financial_account_log_groups;
DROP TABLE financial_account_logs;
DROP TABLE financial_accounts;
-- +goose StatementEnd
