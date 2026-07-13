# General Guideline for Service.

## migration and model database.
migrations separate per service for keep independency principle. we use golang `goose` for migration.
1. model live in folder `./backend/services/[service_name]/[service_name]_models/[models].go`
2. model live in folder `./backend/services/[service_name]/db_migrations`

## development tool
we have development tool that live in `./backend/cmd/tool/*`.
1. it use `urfave/cli/v3`.
2. we have `tool migrate [up|down|create and other]` with service scoped folder.