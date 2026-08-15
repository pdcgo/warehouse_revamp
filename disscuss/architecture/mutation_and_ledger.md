# Mutation and Ledger Log Concept.

## General Brief.
Mutation and ledger is not `library` or `shared table`. its design architecture. this design help:
1. ensure integrity of movement value in transaction.
2. provide better `source of truth` data that statistic can be process it more ease.

this is architectural design later that use in :
1. [stock architecture design](./stock_design.md)

## Implementation Plan.
This ledger design to accomodate :
1. Stock Ledger.
2. Order Revenue Ledger.
3. Payment and Balance Ledger.



## What is mutation ?
mutation is bussiness logic like `RestockCreateMutation`, `RestockAcceptMutation`

## Ledger
There is 3 component about the ledger.
1. state.
2. ledger log.
3. scope.

Ledger is using for audit and source of truth of event processing.


## Flow Mutation and Ledger.
```mermaid
sequenceDiagram

box Bussiness Transaction Related
	participant usr as User
	participant mut as Restock Create Mutation
end

participant lg as Ledger Manager

box Database
participant st as State Ledger Table
participant lglog as Ledger Log Table
participant db as Database

end




usr->>+mut: create restock
mut->>+db: open database transaction
mut->>db: do locking (prevent race condition)

mut-->>mut: doing bussiness logic, like create restock and etc. And get `transaction_id`


	mut->>+lg: open ledger write session with `transaction_id` and pass opened transaction tx *gorm.DB
	lg->>+st: get states.
	alt Exist
		st-->>-lg: return states
	else Not Exist
		lg->>+st: create states
		st-->>-lg: states created
	end
	lg->>st: lock states

	mut->>lg: write change list +/- to ledger
	loop
		lg->>+st: update atomic balance + change
		st-->>-lg: return new balance
		lg->>+lglog: writing change log and after balance form returning new balance
		lglog-->>-lg: return log
	end

	alt Ledger Error
		lg-->>mut: return error
	else
		lg-->>-mut: return ledger log transaction.
	end

alt Error Happen
	db-->>mut: rolback transaction
	mut-->>usr: return error

else
	db-->>-mut: commit database transaction
	mut-->>-usr: return transaction_id(uint) and ledger log
end
```

## Entity Relationship Template.
This is template how service need ledger design to be implemented. each table can contain additional column depend on service requirement. 

```mermaid
erDiagram
	lglog[ledger_logs] {
		uint id "primary_key"
		any scope "scope is can be many field unique, for example (warehouse_id, product_id) or single field (batch_id)"
		uint transaction_id
		uint actor_id
	
		float64 change
		float64 after_balance
	
		datetime created_at
	}


	st[ledger_state] {
		uint id "primary_key"
		any scope "scope is can be many field unique, for example (warehouse_id, product_id) or single field (batch_id)"
		float64 balance
		datetime updated_at
		datetime created_at
	}

	tx[transaction]{
		uint id "primary_key"
		any field "any additional field that transaction needed."
		datetime created_at
	}

	tx ||--|{ lglog : contain
	st ||--|{ lglog : scope 
```

## State.
State is keep the ledger state. state is usefull to hold data the current condition.
1. in stock case. its usefull for hold data:
	- stock_balance
	- stock_balance_valuation

2. in case payment. its usefull for hold data:
	- payable_balance
	- receivable_balance

## Scope
why term scope exist. scope is use smallest grain to track ledger balance.
1. for example, if we track stock balance scoped by `batch_id`, thats mean table have field `batch_id`
2. scope is unique, and can be multiple fields.

## Ledger Log.
Ledger Log is history record of state change and this is **source of truth** state change. so service that implemented that design cannot change the `State` without log recorded in `Ledger Log`

## What is `transaction` Mean in Schema ?.
transaction is can be `InventoryTransaction` or `PaymentTransaction`


# Statistic Design.

## General Guideline.
1. we rely [event_library](./event_library.md) for processing event.
2. **Statistic is streaming and reconcile every midnight + 1 hour**.
3. **Statistic have plan to be covered :**
	- Time Based Metric:
		- daily
		- monthly
		- yearly
	
	- Group Based Metric like:
		- Product Grouped.
		- User Grouped.

4. **Complex Statistic can be heavy if we just rely on database query. For handle that we use event streaming and materialize table.**
	<br>Instead of :
	```mermaid
	sequenceDiagram

	participant ui as Frontend/UI
	participant srv as Service RPC
	participant db as Database

	ui->>+srv: Request Stat
	srv->>+db: run heavy (join, filter, and sort)
	db-->>-srv: return data
	srv-->>-ui: Return Stat
	```
	
	<br>The Solution :
	```mermaid
	sequenceDiagram

	participant ui as Frontend/UI
	participant srv as Service RPC
	participant db as Materialize Metric Table
	participant st as StatProcessing
	participant pub as Pub/Sub

	ui->>+srv: Request Stat
	srv->>+db: simple select query
	db-->>-srv: return data
	srv-->>-ui: Return Stat

	loop Processing loop
		pub->>st: receive event
		st<<->>db: sync
	end
	

	```


## General Flow and How Ledger Become **Source of Truth** of statistic.
**For Flow we take StockCreate for example.**

```mermaid
sequenceDiagram

box Frontend
	participant usr as User
end

box Stock Service
	participant rpc as RPC Service
	participant mut as Mutation
end


participant pub as Google Pub/Sub

box Worker Stat / Stat Service
	participant sub as Push Subscriber / Pull Subscriber
	participant idem as Idempotent Layer
	participant pipe as Stat Processing Pipeline
	participant db as Database
end

participant srv as Other Service

usr->>+rpc: create restock
	rpc->>+mut: call mutation
	mut-->>-rpc: return result

	rpc->>pub: send event, restock_id + ledger log
	
	loop pull / push event  
		pub->>+sub: receive event

		sub->>+idem: check duplication event
		alt If Duplicate
			idem-->>-sub: duplicate
			sub-->>pub: ack event
		else Not Duplicate
			idem->>pipe: send to pipeline to process

			alt Preloading Data if Needed
				pipe->>+srv: requesting data for preloading
				srv-->>-pipe: return preloading data
			end

			pipe->>+db: sync to database
			db-->>-pipe: sync success	

			alt Processing Success
				pipe-->>sub: processing success
				sub-->>-pub: ack event
			else Processing Error
				pipe-->>sub: processing error
				sub-->>pub: Nack event
			end


			
		end

		
	end

rpc-->>-usr: return 'restock_id'
```

## Idempotency Layer.
1. Every Worker Stat / Service that receiving event has own Idempotency Layer.
2. Every service has own table. for Example:
	- StockService &rarr; that be `stock_event_logs`
	- OrderService &rarr; that be `order_event_logs`
3. For Keeping performance, we run periodic flush delete when `received_at` < `6 month`


### Schema.
```mermaid
erDiagram

evt[event_logs]{
	uint64 message_id "primary_key"
	byte data
	datetime received_at
}

```

### Idempotency Flow.
This Explain how we check idempotency event.
```mermaid
sequenceDiagram

participant pub as Pub/Sub
participant idem as Idempotency Layer
participant log as Event Log
participant pipe as Process Pipeline 

pub->>+idem: Receive Event
idem->>+log: try insert in table

alt Insert Success
	log-->>-idem: insert success
	idem->>+pipe: send to process
	pipe-->>-idem: process success
	idem-->>-pub: Ack Event
else Fails
	log-->>+idem: insert fails
	idem-->>-pub: Nack Event
end

```
