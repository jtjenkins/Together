# Self-Hosting Together

This guide walks through deploying Together on your own server using Docker Compose. No Kubernetes,
no complex infrastructure — just Docker and a `.env` file.

`docker compose up -d` starts three containers:

| Container | Role |
|---|---|
| **postgres** | Database |
| **server** | Rust API backend |
| **web** | Nginx serving the React frontend + reverse-proxying the API |

The web container is the only one that needs to be publicly reachable. The backend and database
containers are internal to the Docker network.

---

## Prerequisites

- **Docker Engine** 24.0+ with the **Compose v2 plugin** (`docker compose` — not `docker-compose`)
- Port **80** (or your chosen `BIND_PORT`) open to your users
- ~512 MB RAM minimum; 1 GB recommended

Verify your setup:

```bash
docker compose version   # must show v2.x
```

---

## 1. Get the Compose file

Pre-built images are published to Docker Hub on every release — **no need to clone the
repository or compile anything.** Download just the two files you need:

```bash
mkdir together && cd together
curl -fsSL https://raw.githubusercontent.com/jtjenkins/Together/main/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/jtjenkins/Together/main/.env.example -o .env.example
```

> **Building from source?** Clone the repo instead (`git clone https://github.com/jtjenkins/Together.git`)
> and run `docker compose build` before `docker compose up -d`. This is only needed if you want
> to modify the server or frontend code.

---

## 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in every variable:

| Variable            | Required | Description                                                                              | Example               |
|---------------------|----------|------------------------------------------------------------------------------------------|-----------------------|
| `POSTGRES_USER`     | Yes      | PostgreSQL username                                                                      | `together`            |
| `POSTGRES_PASSWORD` | Yes      | PostgreSQL password — **change this**                                                    | `s3cur3-p@ssword`     |
| `POSTGRES_DB`       | Yes      | Database name                                                                            | `together_prod`       |
| `JWT_SECRET`        | Yes      | Secret used to sign JWTs — must be 32+ characters. Generate: `openssl rand -hex 32`     | _(random hex string)_ |
| `BIND_PORT`         | No       | Host port the **web** container listens on (default `80`)                               | `80`                  |
| `GIPHY_API_KEY`     | No       | Enables the GIF picker. Get a free key at [giphy.com/developers](https://developers.giphy.com) | _(api key)_ |
| `ALLOWED_ORIGINS`   | No       | Only needed if you expose the backend directly. Leave empty when using the web container | —                     |
| `RUST_LOG`          | No       | Log level (default: `together_server=info,tower_http=info,sqlx=warn`)                   | —                     |

> **Security note**: `JWT_SECRET` must be kept secret and must never be committed to version
> control. If it leaks, rotate it immediately — all active sessions will be invalidated.

---

## 3. Start the services

```bash
docker compose up -d
```

This command:

1. Pulls `jtjenkins/together-server:latest` and `jtjenkins/together-web:latest` from Docker Hub
2. Starts PostgreSQL and waits for it to be healthy
3. Starts the backend (migrations run automatically on startup)
4. Starts Nginx serving the web UI at `http://your-server:80`

---

## 4. Verify the deployment

```bash
curl http://localhost/api/health
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

Then open **http://localhost** in a browser — you should see the Together login screen.

If `database` is `"unavailable"`, PostgreSQL is still starting. Wait a few seconds and retry.

---

## 5. Connecting clients

**Web browser:** Open `http://your-server` (or `https://your-server` if behind TLS termination).

**Desktop app (Tauri):** On first launch, the app shows a **Server Setup** screen. Enter
`http://your-server` (the web container address, not the backend port).

**Mobile app (Tauri v2):** Same as desktop — enter your server URL on first launch.

> If you want the desktop or mobile apps to connect without the Nginx web container (e.g. for
> development), uncomment `BIND_BACKEND_PORT` in `docker-compose.yml` to expose the backend
> directly on port 8080.

---

## 6. Upgrading

```bash
docker compose pull
docker compose up -d
```

`docker compose pull` fetches the latest images from Docker Hub. Migrations run automatically
on server startup — no manual step needed.

---

## 7. Backup

```bash
./scripts/backup.sh
```

Saves a compressed SQL dump to `./backups/together_YYYYMMDD_HHMMSS.sql.gz`. Pass a custom
directory as the first argument:

```bash
./scripts/backup.sh /mnt/backups
```

---

## 8. Restore

```bash
gunzip < backups/together_DATE.sql.gz | \
  docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
```

---

## 9. Viewing logs

```bash
docker compose logs -f server   # backend API logs
docker compose logs -f web      # Nginx access and error logs
docker compose logs -f postgres # database logs
```

In production (`APP_ENV=production`), server logs are structured JSON — pipe to `jq` or your
preferred log aggregator.

---

## 10. Metrics

Prometheus metrics are available on the backend, but are restricted to loopback connections.
To scrape them, run:

```bash
docker compose exec server curl -s http://localhost:8080/metrics
```

For continuous scraping, add a Prometheus service to your Compose file and scrape
`http://server:8080/metrics` from within the Docker network.

---

## 11. TLS / HTTPS

Together's Nginx container speaks plain HTTP on port 80. Terminate TLS in front of it.

**Caddy (easiest — automatic HTTPS):**

```
chat.example.com {
    reverse_proxy localhost:80
}
```

Set `BIND_PORT=8081` (or any non-80 port) if Caddy runs on the same host, to avoid port
conflicts.

**Cloudflare Tunnel (no port forwarding required):**

```bash
cloudflared tunnel --url http://localhost:80
```

**nginx reverse proxy:**

```nginx
server {
    listen 443 ssl;
    server_name chat.example.com;
    ssl_certificate     /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
}
```

---

## Environment variable reference

| Variable            | Required | Default                        | Description                                       |
|---------------------|----------|--------------------------------|---------------------------------------------------|
| `POSTGRES_USER`     | Yes      | —                              | PostgreSQL username                               |
| `POSTGRES_PASSWORD` | Yes      | —                              | PostgreSQL password                               |
| `POSTGRES_DB`       | Yes      | —                              | PostgreSQL database name                          |
| `DATABASE_URL`      | Auto     | _(set by compose)_             | Full connection URL; Compose sets this            |
| `JWT_SECRET`        | Yes      | —                              | JWT signing secret (32+ chars)                    |
| `APP_ENV`           | No       | `development`                  | Set to `production` for JSON logs + strict CORS   |
| `ALLOWED_ORIGINS`   | No       | _(empty)_                      | CORS origins — only needed if bypassing Nginx     |
| `BIND_PORT`         | No       | `80`                           | Host port for the Nginx web container             |
| `GIPHY_API_KEY`     | No       | _(GIF picker disabled)_        | Giphy API key for the GIF search feature          |
| `RUST_LOG`          | No       | `together_server=info,...`     | Log level filter                                  |
