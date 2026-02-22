# Self-Hosting Together

This guide walks through deploying Together on your own server using Docker Compose. No Kubernetes,
no complex infrastructure — just Docker and a `.env` file.

---

## Prerequisites

- **Docker Engine** 24.0+ with the **Compose v2 plugin** (`docker compose` — not `docker-compose`)
- An open port (default **8080**) reachable by your clients
- ~512 MB RAM minimum; 1 GB recommended

Verify your setup:

```bash
docker compose version   # must show v2.x
```

---

## 1. Clone the repository

```bash
git clone https://github.com/yourusername/together.git
cd together
```

---

## 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in every variable:

| Variable | Description | Example |
|---|---|---|
| `POSTGRES_USER` | PostgreSQL username | `together` |
| `POSTGRES_PASSWORD` | PostgreSQL password — **change this** | `s3cur3-p@ssword` |
| `POSTGRES_DB` | Database name | `together_prod` |
| `JWT_SECRET` | Secret used to sign JWTs — must be 32+ characters. Generate with `openssl rand -hex 32` | *(random hex string)* |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed for CORS. Set to your domain(s) in production. | `https://chat.example.com` |
| `BIND_PORT` | Host port the server listens on (default `8080`) | `8080` |

> **Security note**: `JWT_SECRET` must be kept secret and should never be committed to version
> control. If it leaks, rotate it immediately — all active sessions will be invalidated.

---

## 3. Start the services

```bash
docker compose up -d
```

This command:
1. Builds the Together server image from source (first run takes ~2 min)
2. Starts PostgreSQL and waits for it to be healthy
3. Starts the Together server (migrations run automatically on startup)

---

## 4. Verify the deployment

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "together-server",
  "version": "0.1.0",
  "database": "ok"
}
```

If `database` is `"unavailable"`, PostgreSQL is still starting — wait a few seconds and retry.

---

## 5. Connecting clients

Each Together client needs to know your server's address. Replace `localhost:8080` with your
server's IP or hostname.

**Desktop (Tauri):**
On first launch the app shows a **Server Setup** screen. Enter `http://your-server:8080` and click
Connect.

**Web (React):**
Set the `VITE_API_URL` environment variable before building:
```bash
cd clients/web
VITE_API_URL=http://your-server:8080 npm run build
```

**Mobile (Expo/React Native):**
The app prompts for a server URL on first launch. Enter `http://your-server:8080`.

---

## 6. Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

Database migrations run automatically on server startup — no manual migration step needed.

---

## 7. Backup

Run the included backup script to dump the database to a compressed SQL file:

```bash
./scripts/backup.sh
```

By default, backups are saved to `./backups/together_YYYYMMDD_HHMMSS.sql.gz`. You can pass a
custom directory:

```bash
./scripts/backup.sh /mnt/backups
```

The script requires the `postgres` container to be running.

---

## 8. Restore

To restore from a backup:

```bash
gunzip < backups/together_DATE.sql.gz | \
  docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
```

Replace `DATE` with the timestamp in the filename and make sure `POSTGRES_USER` and `POSTGRES_DB`
are set in your environment (they'll be loaded from `.env` automatically if you're in the repo
root).

---

## 9. Viewing logs

```bash
docker compose logs -f server     # Together server logs
docker compose logs -f postgres   # PostgreSQL logs
```

In production (`APP_ENV=production`), server logs are emitted as structured JSON, suitable for
ingestion by Loki, CloudWatch, or any JSON-aware log aggregator.

---

## 10. Metrics

Together exposes a Prometheus-compatible metrics endpoint:

```
GET http://your-server:8080/metrics
```

Point your Prometheus scrape config at this endpoint. No authentication is required for the metrics
endpoint (restrict access at your firewall or reverse proxy if needed).

---

## 11. TLS / HTTPS

Together itself speaks plain HTTP. For TLS termination in front of Together, two approaches work
well:

**Cloudflare Tunnel** (easiest, free):
```bash
cloudflared tunnel --url http://localhost:8080
```
Cloudflare handles TLS and provides a public hostname. No port forwarding needed.

**Reverse proxy** (nginx, Caddy, Traefik):
Point your reverse proxy at `http://localhost:8080` (or the Docker network address if co-located).
Together does not need any reverse proxy-specific configuration — it handles WebSocket upgrades
natively.

Example Caddy config:
```
chat.example.com {
    reverse_proxy localhost:8080
}
```

---

## Environment variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | Yes | — | PostgreSQL username |
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password |
| `POSTGRES_DB` | Yes | — | PostgreSQL database name |
| `DATABASE_URL` | Auto | *(set by compose)* | Full connection URL; Compose sets this automatically |
| `JWT_SECRET` | Yes | — | JWT signing secret (32+ chars) |
| `APP_ENV` | No | `development` | Set to `production` for JSON logs and strict CORS |
| `ALLOWED_ORIGINS` | No | *(empty = block all cross-origin)* | Comma-separated allowed CORS origins |
| `BIND_PORT` | No | `8080` | Host port mapped to container port 8080 |
| `RUST_LOG` | No | `together_server=info,...` | Log level filter (tracing-subscriber format) |
