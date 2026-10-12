# Settlement Importer Service


## General.
1. we have service that named `settlement_importer_service`
2. for reading excel, we use [Excel Reader](../../technical/packages/excel_readers/context.md)

## Responsbility
1. Provide automatic record settlement from xls file that downloadable by user for external platforms. for now its supported 2 platform :
    - Shopee
    - Tiktok

## Rpc That Must Have.
1. `TiktokSettlementImport(request) return (stream response)`
2. `ShopeeSettlementImport(request) return (stream response)`
3. `UploadedFileList`

## Rpc Detail.
1. Tiktok
```proto

message Payload {
    uint64  shop_id
    bytes   file_content
}

```

2. Shopee
```proto

message Payload {
    uint64  shop_id
    bytes   file_content
}

```

3. For Response Stream 
```proto

enum LogLevel {
    LOG_LEVEL_UNSPECIFIED
    LOG_LEVEL_INFO
    LOG_LEVEL_WARN
    LOG_LEVEL_ERROR
}

message Response {
    LogLevel level
    string message
}

```




## Flow.
1. Check Shop use `ShopAccessCheck`, for more reference use [this](../shop/context.md)
```mermaid
sequenceDiagram

    participant fe as Frontend

    box Backend
        
        participant import as Importer Service
        participant mp as Shop Service
        participant doc as Document Service
        participant settle as Settlement Service
        
    end

    

    fe->>+import: call Settlement import

    rect rgb(54, 9, 179)
    note right of fe: Validation File Flow

        import->>+mp: check shop: is caller that access on shop, is shop correct
        mp-->>-import: return check
        import-->>fe: Send Message Log
        

    end

    import->>+doc: Upload To Doc Service
    doc-->>-import: Upload Success
    import-->>-fe: Send Message Log

    import-->>import: extract to settlement record
    import-->>fe: send count record for frontend progress render

    loop Loop Every Settlement Record

        %% GenerateUniqueID
        %% rect rgba(190, 5, 175, 0.74)
        import-->>import: row generate `GenerateUniqueID`
        import->>+settle: post to settlement service
        settle-->>-import: success or already exists
        import-->>fe: Send Message Log
        import-->>fe: send step and count record for frontend progress render
        %% end

    end

    import-->>fe: close stream
```

## How We Decide `user_id` in Settlement importer in Every Rows.
```mermaid
flowchart TD
    s(("Start"))
    e(("End"))

    s-->r["Row"]
    r-->isord{"Is Have Order Ref ID ?"}
    isord-->|yes|ordcheck["check Ref On Order Service"]
        ordcheck-->isExist{"Is Order Exist ?"}
        isExist-->|yes|useord["use user_id from order"]
        useord-->e

        isExist-->|no|usep
        
    isord-->|no|usep["use primary_user_id from rpc `ShopAccessCheck`"]


    usep-->e

```