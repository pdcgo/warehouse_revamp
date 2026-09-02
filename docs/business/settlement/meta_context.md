# Meta Contexts.
Settlement is a service that name `settlement_service`. this file explain about metadata, configuration that exists in this service.
1. We should have table that hold this configuration, metadata & configuration of this service. The table is name `settlement_service_metadata`


## `settlement_service_metadata` Table.
### Structure.
1. its should have field:
    - `id`, primary key
    - `key`, string with unique
    - `value`, string

## Whats Inside `settlement_service_metadata`.
1. Process Event Lock.

    Used when Developer need maintain the event processing.
    - key: `process_event_lock`
    - value: `{ lock: true|false }`

 

