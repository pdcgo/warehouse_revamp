package main

// ai should not touch this
import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"time"

	"cloud.google.com/go/storage"
	_ "github.com/GoogleCloudPlatform/cloudsql-proxy/proxy/dialers/postgres"
	"github.com/pdcgo/san_receipt_readers"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_config"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type Database struct {
	Name     string `yaml:"name"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	Instance string `yaml:"instance"`
}

func (d *Database) ToDsn(appname string) string {
	return fmt.Sprintf(
		"user=%s password=%s dbname=%s host=%s application_name=%s sslmode=disable",
		d.User,
		d.Password,
		d.Name,
		d.Instance,
		appname,
	)
}

type Config struct {
	Database Database `yaml:"database"`
}

type Order struct {
	Status      string
	OrderRefID  string
	Receipt     string
	ReceiptFile string
	OrderFrom   string
}

func main() {
	var cfg Config
	ctx := context.Background()

	err := san_config.NewConfiguration(&cfg,
		san_config.NewGoogleSecretProvider(ctx, os.Getenv("GOOGLE_CLOUD_PROJECT"), "warehouse_config"),
	)

	if err != nil {
		panic(err)
	}

	slog.Info("connecting database")
	db, err := gorm.Open(postgres.New(postgres.Config{
		DriverName: "cloudsqlpostgres",
		DSN:        cfg.Database.ToDsn("warehouse-revamp"),
	}), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		panic(err)
	}

	var c int = 13342

	rows, err := db.Raw(fmt.Sprintf(
		`	
			select
				o.status,
				o.order_ref_id,
				o.receipt,
				o.receipt_file,
				o.order_from
			from orders o
			where o.status not in ('completed', 'cancel', 'return_completed', 'return_problem', 'return')
			order by o.created_at asc, o.order_from asc
			offset %d
		`,
		c,
	)).Rows()

	if err != nil {
		panic(err)
	}

	slog.Info("opening cloud storage")
	client, err := storage.NewClient(ctx)
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	bucket := client.Bucket("gudang_assets_temp")

	slog.Info("Iterate the file")

	for rows.Next() {
		logger := slog.With(
			slog.Int("iterate", c),
		)

		c++

		var ord Order
		err := db.ScanRows(rows, &ord)
		if err != nil {
			panic(err)
		}

		path := fmt.Sprintf("transaction_resources/%s.pdf", ord.ReceiptFile)
		r, err := bucket.Object(path).NewReader(ctx)
		if err != nil {
			logger.Error(err.Error())
			continue
		}

		logger.Info(ord.OrderRefID, "status", ord.Status, "file", ord.ReceiptFile)

		res, err := san_receipt_readers.Extract(r)

		switch {
		case errors.Is(err, san_receipt_readers.ErrNotShippingLabel):
			saveFile(ctx, bucket, path, fmt.Sprintf("./examples/receipt_file_samples/pdc_samples/%s.pdf", ord.ReceiptFile))
			logger.Error(err.Error(), "extracted", res.Receipt, "source", ord.Receipt)
			time.Sleep(10 * time.Second)
			r.Close()
			continue

		case err != nil:
			saveFile(ctx, bucket, path, fmt.Sprintf("./examples/receipt_file_samples/%s.pdf", ord.ReceiptFile))
			logger.Error("extract error", "extracted", res.Receipt, "source", ord.Receipt)

			panic(err)
		}

		if res.Receipt != ord.Receipt {
			logger.Error("receipt not match", "source", ord.Receipt, "res", res)
			saveFile(ctx, bucket, path, fmt.Sprintf("./examples/receipt_file_samples/mismatched/%s ( %s )( %s ).pdf", ord.ReceiptFile, ord.Receipt, res.Receipt))
			time.Sleep(10 * time.Second)
			r.Close()
			continue
		}

		logger.Info("data", "res", res)

		r.Close()
	}
}

func saveFile(ctx context.Context, bucket *storage.BucketHandle, path string, dst string) error {
	r, err := bucket.Object(path).NewReader(ctx)
	if err != nil {
		log.Fatal(err)
	}
	f, err := os.Create(dst) // truncates if it exists
	if err != nil {
		return err
	}

	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
