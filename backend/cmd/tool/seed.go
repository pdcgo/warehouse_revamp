package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/urfave/cli/v3"
	"golang.org/x/crypto/bcrypt"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

func seedCommand() *cli.Command {
	return &cli.Command{
		Name:  "seed",
		Usage: "seed data (development)",
		Commands: []*cli.Command{
			{
				Name:      "root",
				Usage:     "set the root account's password",
				ArgsUsage: " ",
				Description: "The root account (user 1, ROLE_ROOT in team 1) is created by a migration with\n" +
					"an EMPTY password, which bcrypt can never match — so a freshly migrated system\n" +
					"has a root user that cannot log in. This sets its password.\n\n" +
					"A default password in the migration would ship to production. This cannot.",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:     "password",
						Usage:    "the root password to set",
						Sources:  cli.EnvVars("ROOT_PASSWORD"),
						Required: true,
					},
					&cli.StringFlag{
						Name:    "dsn",
						Sources: cli.EnvVars("DATABASE_URL"),
						Usage:   "postgres DSN; skips the Local/Production prompt",
					},
				},
				Action: runSeedRoot,
			},
			{
				Name:  "dev",
				Usage: "populate the all-teams DEVELOPMENT fixture",
				Description: "Creates sample teams, an all-teams superuser, and a few scoped users so the UI\n" +
					"has something to show. Idempotent — safe to re-run.\n\n" +
					"HARD-REFUSES a Production target. This fixture ships known credentials on\n" +
					"purpose, so it must never touch production — the guard is by construction, not\n" +
					"by remembering. It also lives here in `seed`, never in a migration (migrations\n" +
					"run against prod by design).",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:    "password",
						Usage:   "password for every seeded dev account",
						Sources: cli.EnvVars("DEV_PASSWORD"),
						Value:   "devpassword123",
					},
					&cli.StringFlag{
						Name:    "dsn",
						Sources: cli.EnvVars("DATABASE_URL"),
						Usage:   "postgres DSN; skips the Local/Production prompt",
					},
				},
				Action: runSeedDev,
			},
			{
				Name:  "categories",
				Usage: "upsert the product-category taxonomy from a JSON file",
				Description: "Upserts the global product-category tree from seed_asset/category.json (the\n" +
					"Shopee Indonesia taxonomy). Idempotent — matches an existing active category by\n" +
					"(parent, name) and inserts only what is missing, so re-running adds nothing.\n\n" +
					"Unlike the dev fixture this is real reference data, so it is NOT refused against\n" +
					"Production — the database prompt (and the production confirmation) still guards it.",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:    "file",
						Aliases: []string{"f"},
						Usage:   "path to the category JSON",
						Value:   "seed_asset/category.json",
					},
					&cli.StringFlag{
						Name:    "dsn",
						Sources: cli.EnvVars("DATABASE_URL"),
						Usage:   "postgres DSN; skips the Local/Production prompt",
					},
				},
				Action: runSeedCategories,
			},
		},
	}
}

// categorySeed is one node of the taxonomy JSON: a name and its (optional) children. The tree is
// self-describing, so nesting is arbitrary — the DB carries it as parent_id.
type categorySeed struct {
	Name     string         `json:"name"`
	Children []categorySeed `json:"children"`
}

func runSeedCategories(ctx context.Context, cmd *cli.Command) error {
	raw, err := os.ReadFile(cmd.String("file"))
	if err != nil {
		return fmt.Errorf("reading category file: %w", err)
	}

	var doc struct {
		Categories []categorySeed `json:"categories"`
	}

	err = json.Unmarshal(raw, &doc)
	if err != nil {
		return fmt.Errorf("parsing category file: %w", err)
	}

	if len(doc.Categories) == 0 {
		return errors.New("the category file has no `categories`")
	}

	db, target, err := resolveDatabase(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	inserted, err := upsertCategories(ctx, db, doc.Categories, nil)
	if err != nil {
		return err
	}

	log.Printf("categories seeded (target=%s): %d inserted (existing rows left untouched)", target, inserted)

	return nil
}

// upsertCategories walks the tree depth-first, ensuring each node under `parentID` and recursing into
// its children with the node's own id as their parent. Returns how many rows it actually inserted.
func upsertCategories(ctx context.Context, db *sql.DB, nodes []categorySeed, parentID *uint64) (int, error) {
	inserted := 0

	for _, node := range nodes {
		name := strings.TrimSpace(node.Name)
		if name == "" {
			return inserted, errors.New("a category has an empty name")
		}

		id, created, err := ensureCategory(ctx, db, name, parentID)
		if err != nil {
			return inserted, fmt.Errorf("category %q: %w", name, err)
		}

		if created {
			inserted++
		}

		if len(node.Children) > 0 {
			sub, err := upsertCategories(ctx, db, node.Children, &id)
			if err != nil {
				return inserted + sub, err
			}
			inserted += sub
		}
	}

	return inserted, nil
}

// ensureCategory returns the id of the active category with this (parent, name), creating it if
// absent. The second return is true only when a row was inserted. Matches the partial unique index
// (COALESCE(parent_id, 0), name) WHERE deleted = FALSE, so a soft-deleted name does not block reuse.
func ensureCategory(ctx context.Context, db *sql.DB, name string, parentID *uint64) (uint64, bool, error) {
	// nil parent must reach the driver as SQL NULL, not 0.
	var parentArg any
	if parentID != nil {
		parentArg = *parentID
	}

	var id uint64

	err := db.QueryRowContext(ctx,
		`SELECT id FROM categories
		 WHERE name = $1 AND COALESCE(parent_id, 0) = COALESCE($2::bigint, 0) AND deleted = FALSE`,
		name, parentArg,
	).Scan(&id)
	if err == nil {
		return id, false, nil
	}

	if !errors.Is(err, sql.ErrNoRows) {
		return 0, false, err
	}

	err = db.QueryRowContext(ctx,
		`INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id`,
		name, parentArg,
	).Scan(&id)

	return id, err == nil, err
}

func runSeedRoot(ctx context.Context, cmd *cli.Command) error {
	password := cmd.String("password")
	if len(password) < 8 {
		return errors.New("the root password must be at least 8 characters")
	}

	db, target, err := resolveDatabase(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	result, err := db.ExecContext(ctx,
		`UPDATE users SET password = $1, updated_at = NOW() WHERE id = 1`,
		string(hash),
	)
	if err != nil {
		return err
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if rows == 0 {
		return fmt.Errorf("no root user — run `migrate up --service user_service` first")
	}

	log.Printf("root password set (target=%s)", target)

	return nil
}

func runSeedDev(ctx context.Context, cmd *cli.Command) error {
	password := cmd.String("password")
	if len(password) < 8 {
		return errors.New("the dev password must be at least 8 characters")
	}

	db, target, err := resolveDatabase(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	// THE GUARD. This fixture creates known-credential superusers, so it must never reach
	// production. Refuse the Production target outright — do not even offer the type-"production"
	// override that `root` allows.
	if target == targetProduction {
		return errors.New("the dev seed refuses to run against Production")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	// Sample teams.
	whID, err := ensureTeam(ctx, db, "warehouse", "Dev Warehouse", "DEVWH")
	if err != nil {
		return fmt.Errorf("dev warehouse team: %w", err)
	}

	sellID, err := ensureTeam(ctx, db, "selling", "Dev Selling", "DEVSELL")
	if err != nil {
		return fmt.Errorf("dev selling team: %w", err)
	}

	// The all-teams superuser: ADMIN in the root team (a global super-admin), and an owner in
	// each sample team so it shows up in their member lists.
	devID, err := ensureUser(ctx, db, "dev", "Dev Superuser", string(hash))
	if err != nil {
		return fmt.Errorf("dev user: %w", err)
	}

	memberships := []struct {
		teamID uint64
		userID uint64
		role   role_basev1.Role
		alias  string
		user   string
	}{
		{san_auth.RootTeamID, devID, role_basev1.Role_ROLE_ADMIN, "dev", "dev"},
		{whID, devID, role_basev1.Role_ROLE_WAREHOUSE_OWNER, "dev", "dev"},
		{sellID, devID, role_basev1.Role_ROLE_TEAM_OWNER, "dev", "dev"},
	}

	// A few scoped, non-admin users so screens have realistic data.
	scoped := []struct {
		username string
		name     string
		teamID   uint64
		role     role_basev1.Role
	}{
		{"wh_owner", "Warehouse Owner", whID, role_basev1.Role_ROLE_WAREHOUSE_OWNER},
		{"wh_staff", "Warehouse Staff", whID, role_basev1.Role_ROLE_WAREHOUSE_STAFF},
		{"seller", "Seller", sellID, role_basev1.Role_ROLE_TEAM_OWNER},
	}

	for _, s := range scoped {
		uid, err := ensureUser(ctx, db, s.username, s.name, string(hash))
		if err != nil {
			return fmt.Errorf("user %s: %w", s.username, err)
		}

		memberships = append(memberships, struct {
			teamID uint64
			userID uint64
			role   role_basev1.Role
			alias  string
			user   string
		}{s.teamID, uid, s.role, s.username, s.username})
	}

	for _, m := range memberships {
		err = ensureMembership(ctx, db, m.teamID, m.userID, m.role, m.alias)
		if err != nil {
			return fmt.Errorf("membership %s@%d: %w", m.user, m.teamID, err)
		}
	}

	log.Printf("dev fixture seeded (target=%s): teams DEVWH/DEVSELL, users dev/wh_owner/wh_staff/seller, password=%q",
		target, password)

	return nil
}

// ensureTeam returns the id of the team with this code, creating it if absent. Idempotent so
// the fixture can be re-run.
func ensureTeam(ctx context.Context, db *sql.DB, teamType, name, code string) (uint64, error) {
	var id uint64

	err := db.QueryRowContext(ctx, `SELECT id FROM teams WHERE team_code = $1`, code).Scan(&id)
	if err == nil {
		return id, nil
	}

	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}

	err = db.QueryRowContext(ctx,
		`INSERT INTO teams (type, name, team_code, description) VALUES ($1, $2, $3, 'dev fixture') RETURNING id`,
		teamType, name, code,
	).Scan(&id)

	return id, err
}

// ensureUser returns the id of the user, creating it if absent and refreshing the password if it
// already exists (so re-running the seed resets known dev passwords).
func ensureUser(ctx context.Context, db *sql.DB, username, name, hash string) (uint64, error) {
	uname := strings.ToLower(strings.TrimSpace(username))

	var id uint64

	err := db.QueryRowContext(ctx, `SELECT id FROM users WHERE LOWER(username) = $1`, uname).Scan(&id)
	if err == nil {
		_, uerr := db.ExecContext(ctx, `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, hash, id)

		return id, uerr
	}

	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}

	err = db.QueryRowContext(ctx,
		`INSERT INTO users (username, email, name, password) VALUES ($1, $2, $3, $4) RETURNING id`,
		uname, uname+"@dev.local", name, hash,
	).Scan(&id)

	return id, err
}

// ensureMembership upserts a (team, user) role. The UNIQUE (team_id, user_id) index makes this a
// real ON CONFLICT upsert — at most one role per user per team.
func ensureMembership(ctx context.Context, db *sql.DB, teamID, userID uint64, role role_basev1.Role, alias string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO user_team_roles (team_id, user_id, role, alias)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role, alias = EXCLUDED.alias`,
		teamID, userID, int32(role), alias,
	)

	return err
}
