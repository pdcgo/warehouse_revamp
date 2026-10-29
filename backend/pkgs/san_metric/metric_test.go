package san_metric

import (
	"errors"
	"strings"
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
)

// The metrics under test are built IN MEMORY rather than declared in proto/ — a test-only message in the contract
// would be served, generated into the frontend and checked by this very package in production.

func orderOption() *analytic_basev1.MetricOption {
	return &analytic_basev1.MetricOption{
		MetricId:         "metrics/orders",
		SupportedFilters: []analytic_basev1.FilterType{analytic_basev1.FilterType_FILTER_TYPE_DATE_RANGE, analytic_basev1.FilterType_FILTER_TYPE_SHOP},
		RequiredFilters:  []analytic_basev1.FilterType{analytic_basev1.FilterType_FILTER_TYPE_DATE_RANGE},
		SupportedGroupBy: []analytic_basev1.GroupType{analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, analytic_basev1.GroupType_GROUP_TYPE_SHOP},
	}
}

func field(
	name string,
	number int32,
	kind descriptorpb.FieldDescriptorProto_Type,
	sort *analytic_basev1.SortOption,
) *descriptorpb.FieldDescriptorProto {
	opts := &descriptorpb.FieldOptions{}
	if sort != nil {
		proto.SetExtension(opts, analytic_basev1.E_MetricSort, sort)
	}

	return &descriptorpb.FieldDescriptorProto{
		Name:     proto.String(name),
		JsonName: proto.String(name),
		Number:   proto.Int32(number),
		Label:    descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
		Type:     kind.Enum(),
		Options:  opts,
	}
}

func message(
	name string,
	option *analytic_basev1.MetricOption,
	fields ...*descriptorpb.FieldDescriptorProto,
) *descriptorpb.DescriptorProto {
	opts := &descriptorpb.MessageOptions{}
	if option != nil {
		proto.SetExtension(opts, analytic_basev1.E_Metric, option)
	}

	return &descriptorpb.DescriptorProto{Name: proto.String(name), Field: fields, Options: opts}
}

// withStat sets a field's (field_stat_type).
func withStat(f *descriptorpb.FieldDescriptorProto, statType analytic_basev1.FieldStatType) *descriptorpb.FieldDescriptorProto {
	proto.SetExtension(f.GetOptions(), analytic_basev1.E_FieldStatType, statType)

	return f
}

var sortable = &analytic_basev1.SortOption{CanSort: true}

const (
	qty      = analytic_basev1.FieldStatType_FIELD_STAT_TYPE_QTY
	currency = analytic_basev1.FieldStatType_FIELD_STAT_TYPE_CURRENCY
	ratio    = analytic_basev1.FieldStatType_FIELD_STAT_TYPE_RATIO
)

func orderCount() *descriptorpb.FieldDescriptorProto {
	return withStat(field("order_count", 1, descriptorpb.FieldDescriptorProto_TYPE_INT64, sortable), qty)
}

// registry builds one file per package, each holding the given messages — the shape of several services' protos.
func registry(t *testing.T, packages map[string][]*descriptorpb.DescriptorProto) *protoregistry.Files {
	t.Helper()

	files := new(protoregistry.Files)

	for pkg, messages := range packages {
		file, err := protodesc.NewFile(&descriptorpb.FileDescriptorProto{
			Name:        proto.String(strings.ReplaceAll(pkg, ".", "/") + "/metric.proto"),
			Package:     proto.String(pkg),
			Syntax:      proto.String("proto3"),
			MessageType: messages,
		}, nil)
		if err != nil {
			t.Fatalf("building %s: %v", pkg, err)
		}

		err = files.RegisterFile(file)
		if err != nil {
			t.Fatalf("registering %s: %v", pkg, err)
		}
	}

	return files
}

func descriptorOf(t *testing.T, files *protoregistry.Files, name string) protoreflect.MessageDescriptor {
	t.Helper()

	found, err := files.FindDescriptorByName(protoreflect.FullName(name))
	if err != nil {
		t.Fatalf("finding %s: %v", name, err)
	}

	return found.(protoreflect.MessageDescriptor)
}

func TestValidateDescriptors(t *testing.T) {
	withOption := func(change func(*analytic_basev1.MetricOption)) *analytic_basev1.MetricOption {
		option := orderOption()
		change(option)

		return option
	}

	cases := []struct {
		name     string
		packages map[string][]*descriptorpb.DescriptorProto
		wantErr  string
	}{
		{
			name: "a well-formed metric, and a plain message beside it",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("OrderMetric", orderOption(),
					orderCount(),
					withStat(field("order_total", 2, descriptorpb.FieldDescriptorProto_TYPE_INT64, nil), currency),
					withStat(field("cancel_rate", 3, descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
						&analytic_basev1.SortOption{CanSort: true, RankMinSample: 50}), ratio),
				), message("Order", nil)},
			},
		},
		{
			name: "two services declare one metric_id",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1":    {message("OrderMetric", orderOption(), orderCount())},
				"settlement.v1": {message("SaleMetric", orderOption(), orderCount())},
			},
			wantErr: `metric_id "metrics/orders" is declared by both`,
		},
		{
			name: "a metric with no metric_id",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("OrderMetric", withOption(func(o *analytic_basev1.MetricOption) { o.MetricId = "" }))},
			},
			wantErr: "with no metric_id",
		},
		{
			name: "a metric with no summary",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("OrderMetric", withOption(func(o *analytic_basev1.MetricOption) {
					o.SupportedGroupBy = []analytic_basev1.GroupType{analytic_basev1.GroupType_GROUP_TYPE_SHOP}
				}))},
			},
			wantErr: "does not list GROUP_TYPE_SUMMARY",
		},
		{
			name: "a required filter it does not support",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("OrderMetric", withOption(func(o *analytic_basev1.MetricOption) {
					o.RequiredFilters = append(o.RequiredFilters, analytic_basev1.FilterType_FILTER_TYPE_SUPPLIER)
				}))},
			},
			wantErr: "requires FILTER_TYPE_SUPPLIER but does not support it",
		},
		{
			name: "an unspecified group",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("OrderMetric", withOption(func(o *analytic_basev1.MetricOption) {
					o.SupportedGroupBy = append(o.SupportedGroupBy, analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED)
				}))},
			},
			wantErr: "lists GROUP_TYPE_UNSPECIFIED",
		},
		{
			name: "a sortable field that is not a number",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("OrderMetric", orderOption(),
					field("shop_name", 1, descriptorpb.FieldDescriptorProto_TYPE_STRING, sortable))},
			},
			wantErr: "is not a single number",
		},
		{
			name: "metric_sort on a message that is not a metric",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("Order", nil, orderCount())},
			},
			wantErr: "is not a metric",
		},
		{
			name: "a negative minimum sample",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"supplier.v1": {message("SupplierMetric", orderOption(),
					withStat(field("broken_rate", 1, descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
						&analytic_basev1.SortOption{CanSort: true, RankMinSample: -1}), ratio))},
			},
			wantErr: "negative rank_min_sample",
		},
		{
			name: "a number field with no stat type",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("OrderMetric", orderOption(),
					field("order_total", 1, descriptorpb.FieldDescriptorProto_TYPE_INT64, nil))},
			},
			wantErr: "carries no field_stat_type",
		},
		{
			name: "a minimum sample on a field that is not a ratio",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"supplier.v1": {message("SupplierMetric", orderOption(),
					withStat(field("lost_count", 1, descriptorpb.FieldDescriptorProto_TYPE_INT64,
						&analytic_basev1.SortOption{CanSort: true, RankMinSample: 50}), qty))},
			},
			wantErr: "is FIELD_STAT_TYPE_QTY, not a RATIO",
		},
		{
			name: "a stat type on a field that is not a number",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("OrderMetric", orderOption(),
					withStat(field("shop_name", 1, descriptorpb.FieldDescriptorProto_TYPE_STRING, nil), qty))},
			},
			wantErr: "is not a single number",
		},
		{
			name: "a stat type on a message that is not a metric",
			packages: map[string][]*descriptorpb.DescriptorProto{
				"selling.v1": {message("Order", nil,
					withStat(field("total", 1, descriptorpb.FieldDescriptorProto_TYPE_INT64, nil), currency))},
			},
			wantErr: "is not a metric",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateFiles(registry(t, tc.packages))

			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("want no error, got %v", err)
				}

				return
			}

			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("want an error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

// The binary's own protos must pass — the same call the server makes at startup.
func TestValidateDescriptorsOnTheBinary(t *testing.T) {
	err := ValidateDescriptors()
	if err != nil {
		t.Fatal(err)
	}
}

func TestSortField(t *testing.T) {
	files := registry(t, map[string][]*descriptorpb.DescriptorProto{
		"supplier.v1": {message("SupplierMetric", orderOption(),
			field("restocked_units", 1, descriptorpb.FieldDescriptorProto_TYPE_INT64, sortable),
			field("broken_rate", 2, descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
				&analytic_basev1.SortOption{CanSort: true, RankMinSample: 50}),
			field("lost_units", 3, descriptorpb.FieldDescriptorProto_TYPE_INT64, &analytic_basev1.SortOption{}),
			field("note_count", 4, descriptorpb.FieldDescriptorProto_TYPE_INT64, nil),
		)},
	})
	metric := descriptorOf(t, files, "supplier.v1.SupplierMetric")

	found, option, err := SortField(metric, "broken_rate")
	if err != nil {
		t.Fatalf("broken_rate: %v", err)
	}

	if found.Name() != "broken_rate" || option.GetRankMinSample() != 50 {
		t.Fatalf("broken_rate: got %s with rank_min_sample %d", found.Name(), option.GetRankMinSample())
	}

	for _, name := range []string{"lost_units", "note_count", "missing", "brokenRate"} {
		_, _, err = SortField(metric, name)
		if !errors.Is(err, ErrNotSortable) {
			t.Errorf("%s: want ErrNotSortable, got %v", name, err)
		}
	}
}

func TestOptionOf(t *testing.T) {
	files := registry(t, map[string][]*descriptorpb.DescriptorProto{
		"selling.v1": {message("OrderMetric", orderOption(), orderCount()), message("Order", nil)},
	})

	option := OptionOf(descriptorOf(t, files, "selling.v1.OrderMetric"))
	if option.GetMetricId() != "metrics/orders" {
		t.Fatalf("OrderMetric: got metric_id %q", option.GetMetricId())
	}

	if OptionOf(descriptorOf(t, files, "selling.v1.Order")) != nil {
		t.Fatal("Order is not a metric, but OptionOf returned an option")
	}
}
