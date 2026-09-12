package main

import (
	"context"

	"github.com/urfave/cli/v3"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_dbtarget"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// San is what every command is handed: the wired dependencies, already pointed at the database
// the operator chose.
//
// Commands are METHODS on it rather than free functions taking a *gorm.DB, so a command can only
// reach a service that the graph actually built — and a test can build one directly.
type San struct {
	db    *gorm.DB
	users *user_v1.Service

	// target is the human label of the chosen database ("Database Local", …). Every command
	// prints it, so the record of what happened always says WHERE it happened.
	target string
}

func NewSan(db *gorm.DB, users *user_v1.Service) *San {
	return &San{db: db, users: users}
}

// Close releases the pool. A CLI exits soon anyway, but a command that has finished should not be
// holding a production connection open while an operator reads its output.
func (s *San) Close() {
	sqlDB, err := s.db.DB()
	if err != nil {
		return
	}

	_ = sqlDB.Close()
}

// withSan resolves the database (prompting unless --dsn was given), builds the graph for it, and
// runs the command against it.
//
// The prompt happens BEFORE the graph is built and the graph takes the DSN as an argument,
// because which database to touch is an operator's per-invocation decision. A provider that read
// it from config instead would make an interactive, guarded choice invisible to Wire.
func withSan(ctx context.Context, cmd *cli.Command, run func(context.Context, *San) error) error {
	dsn, target, err := san_dbtarget.Resolve(cmd.String("dsn"))
	if err != nil {
		return err
	}

	san, err := InitializeSan(DatabaseDSN(dsn))
	if err != nil {
		return err
	}

	defer san.Close()

	san.target = target

	return run(ctx, san)
}
