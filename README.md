# Marketplace API

A small marketplace API described with OpenAPI 3.0.3.

The project uses **Option B: runtime contract validation** with
`express-openapi-validator`.

## Resources

The API contains two main resources:

- Products
- Orders

Available operations:

- `GET /products`
- `GET /products/{id}`
- `GET /orders`
- `POST /orders`
- `GET /orders/{id}`

## OpenAPI contract

The API contract is located at:

```text
openapi/openapi.yaml
```

## Configuration

The application validates configuration at startup with a Zod schema.

Configuration flow:

```text
process.env
    ↓
Zod validation
    ↓
ConfigService<Env, true>
    ↓
Application
```
