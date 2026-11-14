import { DB_NAME } from "./env";

// The automated-test database is SEPARATE from the development database the owner reviews on:
// same Postgres (:5433), different database. Tests must never read or write `postgres`.
//
// ADMIN_DSN points at the maintenance database ("postgres") — used only to drop/create the test
// database. TEST_DSN is what the migrations, the seed, and the e2e backend actually use: warehouse_test,
// or this worker's own database when `san test full --workers N` runs several at once (e2e/env.ts).
export const ADMIN_DSN =
  "host=localhost port=5433 user=user password=password dbname=postgres sslmode=disable";
export const TEST_DSN = `host=localhost port=5433 user=user password=password dbname=${DB_NAME} sslmode=disable`;
