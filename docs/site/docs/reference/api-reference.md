---
outline: deep
---

# REST API Reference

Together provides a REST API for building integrations, bots, and custom tooling. All API endpoints use JSON request/response bodies and JWT-based authentication.

## Base URL

```
https://your-together-instance.com
```

## Authentication

Most endpoints require a valid JWT access token passed in the `Authorization` header:

```
Authorization: Bearer <your_jwt_token>
```

Tokens are obtained through the [authentication flow](/features/authentication).

## Bot Authentication

Bot accounts use a dedicated token authentication mechanism. Bots are created through the admin interface and receive a long-lived API token. Pass it in the `Authorization` header with a `Bot` prefix:

```
Authorization: Bot <your_bot_token>
```

See the [Bot API](/reference/bot-api) for full documentation.

## API Endpoints

### Users & Auth
- `POST /auth/register` — Register a new account
- `POST /auth/login` — Authenticate and receive tokens
- `POST /auth/refresh` — Refresh an expired access token
- `GET /users/@me` — Get current user profile
- `PATCH /users/@me` — Update current user profile

### Servers
- `GET /servers` — List servers the user is a member of
- `POST /servers` — Create a new server
- `GET /servers/:id` — Get server details
- `PATCH /servers/:id` — Update server settings
- `DELETE /servers/:id` — Delete a server

### Channels
- `GET /servers/:server_id/channels` — List channels in a server
- `POST /servers/:server_id/channels` — Create a channel
- `PATCH /channels/:id` — Update channel settings
- `DELETE /channels/:id` — Delete a channel

### Messages
- `GET /channels/:channel_id/messages` — List messages in a channel
- `POST /channels/:channel_id/messages` — Send a message
- `PATCH /messages/:id` — Edit a message
- `DELETE /messages/:id` — Delete a message

### Search
- `GET /servers/:id/search` — Full-text message search (server-scoped)

### ICE
- `GET /ice-servers` — Get TURN/STUN server configuration

## Errors

The API uses standard HTTP status codes:

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 500 | Internal Server Error |

Error responses include a JSON body with a `message` field describing the issue.

## Rate Limiting

The API implements rate limiting to prevent abuse. Headers are included in responses:

- `X-RateLimit-Limit` — Maximum requests per window
- `X-RateLimit-Remaining` — Requests remaining in current window
- `X-RateLimit-Reset` — Unix timestamp when the window resets

## WebSocket Gateway

For real-time communication, Together uses a WebSocket gateway protocol rather than polling. See the [WebSocket Protocol](/reference/websocket-protocol) for details.

## OpenAPI Specification

A complete OpenAPI 3.0 spec is available at [`/docs/openapi.yaml`](/reference/openapi).

## See Also

- [Bot API](/reference/bot-api)
- [Webhooks](/reference/webhooks)
- [WebSocket Protocol](/reference/websocket-protocol)
