# Service RPC Proto Rule.

**This in Programmer Authoritative, and AI agent should not rewrite this without explicit ask.**
---------------------------------------------------------------------------------------
This rule how each service interfacing and serve their data.

1. How they serve stat.
2. How they serve collection data.
3. How they expose the collection data.

Common problem about serving data.

1. Freshness.
2. Latency.
3. Sorting.

## Interfacing Stat Related.

Every stat consist 4 things.

1. Preview.
2. Daily ( Time Range ).
3. Grouping.
4. Sorting.

## Rule Exposing Data Collection Detail.
This solve problem about how get data collection that live/separate in other service by exposing rpc that collection can be get by their id.
<br>For example:
- ProductByIDs
- ShopByIDs
- WarehouseByIDs
- etc.

But the Problem is every service need felxibility partial data/not fully, and load fully data every time is make the computational cost is high.
To solve the problem design that be proposed to this.
```
message ByIdsFilter {
	repeated ids
	
	uint64 team_id 			<--- if any other filter that scoped
	...
}

enum ByIdsDataType { // this hold what kind data that have loaded in response
	BY_IDS_DATA_TYPE_UNSPECIFIED
	BY_IDS_DATA_TYPE_GENERAL
	BY_IDS_DATA_TYPE_RACK_PRODUCT 		// <-- this is for example
}

message ByIdsRequest {
	ByIdsFilter 				filter
	repeated ByIdsDataType 	data_request
}

message GeneralItem {
	uint64 id
	string name
}
message GeneralMapItem { 					// <--- this data always paired ListDataType with LIST_DATA_TYPE_GENERAL
	map<uint64, GeneralItem> map_data
}

// example various data/metric can be loaded
message RackProductItem {
	uint64 	id
	int64 	product_count
	double 	product_amount
}

message RackProductMapItem { 				// <--- this data always paired ListDataType with LIST_DATA_TYPE_RACK_PRODUCT
	map<uint64, RackProductItem> map_data
}

message MapResponseItem {
	oneof d {
		GeneralMapItem 		general
		RackProductMapItem 	rack_product
	}
}

message MapResponseList {
	repeated MapResponseItem
}

message ByIdsResponse {
	map<uint64, MapResponseList> items
}

```

## Rule Exposing Data Collection in List View.
This rule for creating schema rpc data list like for example `RackList`, `ProductList` and other.<br>
All api list must be flexible for load various data and maybe various metric of statistic. So we need flexible structure that can cover it.
Base structure of list api rpc must obey of this structure :
```

enum CommonSortType {
	COMMON_SORT_TYPE_UNSPECIFIED = 0
	COMMON_SORT_TYPE_DESC = 1
	COMMON_SORT_TYPE_ASC = 2
}


message ListFilter {

	...
}

enum ListDataType { // this hold what kind data that have loaded in response
	LIST_DATA_TYPE_UNSPECIFIED
	LIST_DATA_TYPE_GENERAL
	LIST_DATA_TYPE_RACK_PRODUCT 		// <-- this is for example
}


enum GeneralSort { 						// <--- this data always paired ListDataType with LIST_DATA_TYPE_GENERAL
	GENERAL_SORT_UNSPECIFIED
	GENERAL_SORT_NAME
}

enum RackProductSort { 					// <--- this data always paired ListDataType with LIST_DATA_TYPE_RACK_PRODUCT
	GENERAL_SORT_UNSPECIFIED
	GENERAL_SORT_PRODUCT_COUNT			// <--- this sort field is reflected with RackProductItem fields. field with name id usually not included if not explicit necessary
	GENERAL_SORT_PRODUCT_AMOUNT
}


message ListFilterSort {
	CommonSortType sort_type
	oneof s {
		GeneralSort 	general
		RackProductSort rack_product
	}
}

message ListRequest {
	ListFilter 				filter
	ListFilterSort 			sort
	repeated ListDataType 	data_request
	CommonPagination 		page
}

message GeneralItem {
	uint64 id
	string name
}
message GeneralMapItem { 					// <--- this data always paired ListDataType with LIST_DATA_TYPE_GENERAL
	map<uint64, GeneralItem> map_data
}

// example various data/metric can be loaded
message RackProductItem {
	uint64 	id
	int64 	product_count
	double 	product_amount
}

message RackProductMapItem { 				// <--- this data always paired ListDataType with LIST_DATA_TYPE_RACK_PRODUCT
	map<uint64, RackProductItem> map_data
}

message ListResponseItem {
	oneof d {
		GeneralMapItem 		general
		RackProductMapItem 	rack_product
	}
}

message ListResponse {
	repeated ListResponseItem 	items
	repeated uint64 			ids 	// <--- this is sorted ids of the data
}

```

## Rule Exposing Data Collection Overview.
This heavily used for frontend in top of statistic.
Base structure of list api rpc must obey of this structure :
```
message RestockOverviewFilter { // <-- this used for scoping data

	...
}

enum MetricDataType { // this hold what kind data that have loaded in response
	METRIC_DATA_TYPE_UNSPECIFIED
	METRIC_DATA_TYPE_CREATED
	METRIC_DATA_TYPE_COMPLETED
}


enum CreatedSort { 						// <--- this data always paired MetricDataType with METRIC_DATA_TYPE_CREATED
	CREATED_SORT_UNSPECIFIED
	CREATED_SORT_AMOUNT
	CREATED_SORT_COUNT
}



message RestockOverviewFilterSort {
	CommonSortType sort_type
	oneof s {
		CompletedSort 	completed
		CreatedSort		created
	}
}

message RestockOverviewRequest {
	RestockOverviewFilter 				filter
	RestockOverviewFilterSort 			sort
	repeated MetricDataType 			metric_request
	CommonPagination 					page
}

message CreatedItem { // <--- this data always paired MetricDataType with METRIC_DATA_TYPE_CREATED
	int64 count
	double amount
}


message ListResponseItem {
	oneof d {
		CreatedItem 		created
		CompletedItem 		completed
	}
}

message ListResponse {
	repeated ListResponseItem 	items
}

```
