// The automated-test database is SEPARATE from the development database the owner reviews on:
// same Postgres (:5433), different database. Tests must never read or write `postgres`.
//
// ADMIN_DSN points at the maintenance database ("postgres") — used only to drop/create the test
// database. TEST_DSN is what the migrations, the seed, and the e2e backend actually use.
export const ADMIN_DSN =
  "host=localhost port=5433 user=user password=password dbname=postgres sslmode=disable";
export const TEST_DSN =
  "host=localhost port=5433 user=user password=password dbname=warehouse_test sslmode=disable";
