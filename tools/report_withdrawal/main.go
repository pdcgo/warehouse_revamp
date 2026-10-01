package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"

	"cloud.google.com/go/storage"
	_ "github.com/GoogleCloudPlatform/cloudsql-proxy/proxy/dialers/postgres"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_config"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
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

type Resource struct {
	BucketType string
	BucketName string
	Filename   string
	Path       string
	MpType     string
}

func main() {

	var cfg Config
	ctx := context.Background()

	err := san_config.NewConfiguration(&cfg,
		san_config.NewGoogleSecretProvider(ctx, "pdcgudang", "warehouse_config"),
	)

	if err != nil {
		panic(err)
	}

	// initiate database

	db, err := gorm.Open(postgres.New(postgres.Config{
		DriverName: "cloudsqlpostgres",
		DSN:        cfg.Database.ToDsn("warehouse-revamp"),
	}), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		panic(err)
	}

	var c int = 32000

	rows, err := db.Raw(fmt.Sprintf(
		`
	
			select 
				wr.bucket_type,
				wr.bucket_name,
				wr.filename,
				wr.path,
				m.mp_type
			from wd_resources wr 
			left join marketplaces m on wr.marketplace_id = m.id 
			order by wr.created_at desc
			offset %d
		`,
		c,
	)).Rows()

	if err != nil {
		panic(err)
	}

	client, err := storage.NewClient(ctx)
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	bucket := client.Bucket("gudang_assets_temp")

	for rows.Next() {
		var data Resource

		logger := slog.With(
			slog.Int("iterate", c),
		)

		c++

		err := db.ScanRows(rows, &data)
		if err != nil {
			panic(err)
		}

		logger.Info(data.Path, "type", data.MpType)
		r, err := bucket.Object(data.Path).NewReader(ctx)
		if err != nil {
			logger.Error(err.Error())
			continue
		}

		// var tiktokMap TransactionMap

		switch data.MpType {
		case "shopee":
			logger := logger.With(
				slog.String("marketplace", "Shopee"),
			)
			doc, err := san_excel_readers.NewShopeeSettlementDocument(r)

			if err != nil {
				saveFile(ctx, bucket, data.Path, data.MpType+"/"+data.Filename+".xlsx")
				slog.Error(err.Error())
				r.Close()
				continue
			}

			items, err := doc.GetItems()
			if err != nil {
				panic(err)
			}

			for _, item := range items {
				id, err := item.GenerateUniqueID()
				if err != nil {
					slog.Error(err.Error())
					panic(err)
				}

				// logger.Info("item", "data", item)
				settype, err := item.SettlementType()
				if err != nil {
					logger.Error(err.Error(), "item", item)
					panic(err)
				}

				logger.Info(id, "type", settype)
			}

		case "tiktok":
			logger := logger.With(
				slog.String("marketplace", "Tiktok"),
			)

			doc, err := san_excel_readers.NewTiktokSettlementDocument(r)

			if err != nil {
				saveFile(ctx, bucket, data.Path, data.MpType+"/"+data.Filename+".xlsx")
				slog.Error(err.Error())
				r.Close()
				continue
			}

			items, err := doc.GetItems()
			if err != nil {
				panic(err)
			}

			for _, item := range items {
				id, err := item.GenerateUniqueID()
				if err != nil {
					slog.Error(err.Error())
					panic(err)
				}

				// logger.Info("item", "data", item)
				settype, err := item.SettlementType()
				if err != nil {
					logger.Error(err.Error(), "item", item)
					panic(err)
				}

				logger.Info(id, "type", settype)
			}

		default:
			log.Println("unprocessed", data.MpType, data.Path)
		}

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

type TransactionMap map[string]string
