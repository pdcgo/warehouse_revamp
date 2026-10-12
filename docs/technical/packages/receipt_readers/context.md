# Receipt Reader package.

## General.
1. its have submodule repo `https://github.com/pdcgo/san_receipt_readers` live in `backend/packages/san_receipt_readers`

## Contracts.
```go

type CourierType string

type ReceiptData struct {
    Receipt string
    OrderID sring
    Phone string
    CustomerName string
    Address string
}

func Extract(data io.Reader) (ReceiptData, error) 

```