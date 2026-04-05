---
outline: deep
---

# OpenAPI Specification

Together provides a complete OpenAPI 3.0 specification for the REST API.

## Viewing the Spec

The full spec is located at `docs/openapi.yaml` in the Together repository. You can:

1. **View it locally**: Open `docs/openapi.yaml` in any text editor
2. **Use Swagger UI**: Load the spec into [Swagger Editor](https://editor.swagger.io/) or [Swagger UI](https://swagger.io/tools/swagger-ui/)
3. **Use with code generation**: Generate client SDKs using [OpenAPI Generator](https://openapi-generator.tech/)

## Coverage

The OpenAPI spec covers the main REST API endpoints including:
- Authentication (register, login, refresh)
- User management
- Server (guild) management
- Channel management
- Message CRUD operations
- Role management
- Invite management
- Search
- Reactions
- Polls
- Webhooks
- Bot management

## Contributing

If you find an endpoint missing from the spec or a discrepancy between the spec and actual API behavior, please [open an issue](https://github.com/jtjenkins/Together/issues) or submit a PR against `docs/openapi.yaml`.
