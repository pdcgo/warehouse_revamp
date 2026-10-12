// The module is rooted at the REPOSITORY, not at backend/ — so a top-level tool (tools/san) is a
// package of this module rather than a second module needing its own go.mod and a replace.
//
// Import paths are unaffected by that choice: the packages still live under backend/, so
// github.com/pdcgo/warehouse_revamp/backend/pkgs/... resolves exactly as it did when the module
// itself was named …/backend.
module github.com/pdcgo/warehouse_revamp

go 1.25.8

require (
	buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20260415201107-50325440f8f2.1
	buf.build/go/protovalidate v1.2.0
	cloud.google.com/go/pubsub/v2 v2.6.1
	cloud.google.com/go/secretmanager v1.20.0
	connectrpc.com/connect v1.19.0
	connectrpc.com/cors v0.1.0
	connectrpc.com/grpcreflect v1.3.0
	connectrpc.com/validate v0.6.0
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/google/wire v0.7.0
	github.com/jackc/pgx/v5 v5.10.0
	github.com/manifoldco/promptui v0.9.0
	github.com/modelcontextprotocol/go-sdk v1.7.0
	github.com/pdcgo/san_receipt_readers v0.0.0-00010101000000-000000000000
	github.com/pressly/goose/v3 v3.27.2
	github.com/redis/go-redis/v9 v9.21.0
	github.com/rs/cors v1.11.1
	github.com/twilio/twilio-go v1.30.9
	github.com/urfave/cli/v3 v3.10.1
	github.com/xuri/excelize/v2 v2.11.0
	go.opentelemetry.io/otel v1.44.0
	go.opentelemetry.io/otel/trace v1.44.0
	golang.org/x/crypto v0.55.0
	golang.org/x/image v0.44.0
	google.golang.org/api v0.293.0
	google.golang.org/grpc v1.83.0
	google.golang.org/protobuf v1.36.11
	gopkg.in/yaml.v3 v3.0.1
	gorm.io/driver/postgres v1.6.0
	gorm.io/gorm v1.31.2
)

require (
	cloud.google.com/go/monitoring v1.29.0 // indirect
	github.com/GoogleCloudPlatform/opentelemetry-operations-go/detectors/gcp v1.33.0 // indirect
	github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/metric v0.57.0 // indirect
	github.com/GoogleCloudPlatform/opentelemetry-operations-go/internal/resourcemapping v0.57.0 // indirect
	github.com/cncf/xds/go v0.0.0-20260202195803-dba9d589def2 // indirect
	github.com/envoyproxy/go-control-plane/envoy v1.37.0 // indirect
	github.com/envoyproxy/protoc-gen-validate v1.3.3 // indirect
	github.com/go-jose/go-jose/v4 v4.1.4 // indirect
	github.com/ledongthuc/pdf v0.0.0-20260907135840-6c8c28e0e8a0 // indirect
	github.com/lib/pq v1.12.3 // indirect
	github.com/makiuchi-d/gozxing v0.1.1 // indirect
	github.com/planetscale/vtprotobuf v0.6.1-0.20240319094008-0393e58bdf10 // indirect
	github.com/richardlehane/mscfb v1.0.7 // indirect
	github.com/richardlehane/msoleps v1.0.6 // indirect
	github.com/spiffe/go-spiffe/v2 v2.7.0 // indirect
	github.com/tiendc/go-deepcopy v1.7.2 // indirect
	github.com/xuri/efp v0.0.1 // indirect
	github.com/xuri/nfp v0.0.2-0.20250530014748-2ddeb826f9a9 // indirect
	go.opentelemetry.io/contrib/detectors/gcp v1.44.0 // indirect
	go.opentelemetry.io/otel/sdk v1.44.0 // indirect
	go.opentelemetry.io/otel/sdk/metric v1.44.0 // indirect
	go.uber.org/zap v1.28.0 // indirect
	golang.org/x/xerrors v0.0.0-20200804184101-5ec99f83aff1 // indirect
)

require (
	cel.dev/expr v0.25.2 // indirect
	cloud.google.com/go v0.123.0 // indirect
	cloud.google.com/go/auth v0.23.0 // indirect
	cloud.google.com/go/auth/oauth2adapt v0.2.8 // indirect
	cloud.google.com/go/compute/metadata v0.9.0 // indirect
	cloud.google.com/go/iam v1.11.0
	cloud.google.com/go/storage v1.68.0
	github.com/GoogleCloudPlatform/cloudsql-proxy v1.38.3
	github.com/antlr4-go/antlr/v4 v4.13.1 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/chzyer/readline v0.0.0-20180603132655-2972be24d48e // indirect
	github.com/felixge/httpsnoop v1.1.0 // indirect
	github.com/go-logr/logr v1.4.4 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/golang/mock v1.6.0 // indirect
	github.com/google/cel-go v0.28.0 // indirect
	github.com/google/jsonschema-go v0.4.3 // indirect
	github.com/google/s2a-go v0.1.9 // indirect
	github.com/google/subcommands v1.2.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/googleapis/enterprise-certificate-proxy v0.3.20 // indirect
	github.com/googleapis/gax-go/v2 v2.23.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/mfridman/interpolate v0.0.2 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/segmentio/asm v1.2.1 // indirect
	github.com/segmentio/encoding v0.5.4 // indirect
	github.com/sethvargo/go-retry v0.3.0 // indirect
	github.com/yosida95/uritemplate/v3 v3.0.2 // indirect
	go.opencensus.io v0.24.0 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc v0.68.0 // indirect
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.69.0 // indirect
	go.opentelemetry.io/otel/metric v1.44.0 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/exp v0.0.0-20260410095643-746e56fc9e2f // indirect
	golang.org/x/mod v0.38.0 // indirect
	golang.org/x/net v0.58.0 // indirect
	golang.org/x/oauth2 v0.36.0 // indirect
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.41.0 // indirect
	golang.org/x/time v0.15.0 // indirect
	golang.org/x/tools v0.48.0 // indirect
	google.golang.org/genproto v0.0.0-20260519071638-aa98bba5eb94 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260630182238-925bb5da69e7 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260807164820-c8921c73eeea // indirect
)

tool (
	connectrpc.com/connect/cmd/protoc-gen-connect-go
	github.com/google/wire/cmd/wire
	google.golang.org/protobuf/cmd/protoc-gen-go
)

// san_receipt_readers is its own repo, checked out here as a git submodule
// (backend/packages/san_receipt_readers). The replace builds against that checkout, so an edit there is
// seen here at once, without a tag.
replace github.com/pdcgo/san_receipt_readers => ./backend/packages/san_receipt_readers
