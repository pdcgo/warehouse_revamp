# Event Architecture Context.
**This Architecture proposed by Heri, (Toni maybe have another)**

## General Brief
1. We use Goole Pub/Sub.
2. This architecture design used by:
    - [settlement service](../../business/settlement/context.md)

## Responsbility
1. Provide library that any service can use it to publish event.
2. Function that ensure all topic setup properly.



## Event Sender Contract.
1. Send event contract.
    ```go
    type EventSender func(event Event) error
    ```
2. `Event` is from proto definition.
3. event function in produced by 
    ```go
    func NewEventSender(...) EventSender
    ```



## Event Proto Definition
1. Make event is a shared definition that define in `warehouse.events.v1`
2. It's contain:
    - settlement event definition
3. All type wrapped in one definition.
```proto

message OrderCreated { // this is example
    ... 
}

message OrderCancel { // this is example
    ...
}

message Event {
    oneof message {
        OrderCreated    order_created
        OrderCancel     order_cancel
    }
}

```