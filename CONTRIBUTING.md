# Contributing to Together

Thank you for your interest in contributing! Together is a community project and all skill levels
are welcome — whether this is your first open-source contribution or your thousandth.

## A Note on How This Project Is Built

Together is developed with the help of **Claude Code**, an AI coding assistant. The author has a
disability that limits the amount of typing they can do; Claude Code makes it possible to build
and maintain this project. A software engineer guides every design decision, reviews all
generated code, and is responsible for the architecture.

We welcome contributions from humans and from people who use assistive or AI tools themselves.
What matters is the quality and intent of the work, not the method used to produce it.

---

## Ways to Contribute

You do not need to write code to contribute. The project benefits from:

- **Bug reports** — clear reproduction steps are incredibly helpful
- **Documentation improvements** — fixing typos, clarifying confusing sections
- **Feature requests** — open an issue describing the use case
- **Code contributions** — bug fixes, features, test coverage, performance
- **Design feedback** — UI/UX suggestions with reasoning

---

## Before You Start

1. **Check existing issues** — your idea or bug may already be tracked.
2. **Open an issue first** for large changes — this avoids wasted work if the direction doesn't
   fit the project's goals.
3. **Read the Code of Conduct** — [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Everyone deserves
   a welcoming experience.

---

## Setting Up Your Development Environment

### Requirements

- **Rust** 1.75+ (`rustup` is the recommended installer: https://rustup.rs)
- **Node.js** 20+ and **npm** 10+
- **Docker** with the Compose v2 plugin (`docker compose`)

### Clone and start the dev database

```bash
git clone https://github.com/jtjenkins/Together.git
cd Together

# Start a local PostgreSQL instance (port 5432 bound to 127.0.0.1 only)
docker compose -f docker-compose.dev.yml up -d
```

### Run the backend

```bash
cd server
cp .env.example .env   # fill in POSTGRES_PASSWORD and JWT_SECRET

~/.cargo/bin/cargo run
# Server starts on http://localhost:8080
```

> Tip: install `cargo-watch` for auto-reload on file changes:
> `cargo install cargo-watch && cargo watch -x run`

### Run the web client

```bash
cd clients/web
npm install
VITE_API_URL=http://localhost:8080 npm run dev
# Opens http://localhost:5173
```

### Run the desktop app (Tauri)

```bash
cd clients/desktop
npm install
npm run tauri dev
```

---

## Running Tests

**Backend (Rust):**

```bash
cd server

# Integration tests require a running Postgres instance
docker compose -f ../docker-compose.dev.yml up -d

~/.cargo/bin/cargo test
```

> Tests create and clean up their own isolated data. They are safe to run against your dev
> database.

**Web client:**

```bash
cd clients/web
npm test          # interactive watch mode
npm test -- --run # single pass (used in CI)
```

**Type checking:**

```bash
cd clients/web
npx tsc --noEmit
```

---

## Code Style

**Rust:**

- Run `~/.cargo/bin/cargo fmt` before committing — CI enforces formatting.
- Run `SQLX_OFFLINE=true ~/.cargo/bin/cargo clippy -- -D warnings` to catch lint issues.
- New handlers should follow the patterns in `server/src/handlers/` (see `messages.rs` for a
  complete example with auth middleware, validation, and error handling).

**TypeScript / React:**

- Run `npm run lint` before committing.
- Components use CSS Modules (`.module.css`). Do not use inline styles or global class names.
- State lives in Zustand stores under `clients/web/src/stores/`. Keep component logic thin.

---

## Submitting a Pull Request

1. Fork the repository and create a branch from `main`:
   ```bash
   git checkout -b fix/your-descriptive-branch-name
   ```
2. Make your changes. Write or update tests where appropriate.
3. Ensure all tests pass and there are no lint/type errors.
4. Commit with a clear message describing *why* the change is needed, not just what changed.
5. Open a pull request against `main`. Fill out the PR template with a summary and test plan.

Pull requests are reviewed by the maintainer. Feedback is constructive and meant to improve the
code, not to judge you. If something is unclear, ask — no question is too basic.

---

## Project Structure (Quick Reference)

```
Together/
├── server/               # Rust/Axum backend (single binary)
│   ├── src/handlers/     # HTTP route handlers
│   ├── src/models/       # Database model structs
│   ├── migrations/       # SQL migration files (auto-applied on startup)
│   └── tests/            # Integration tests
│
├── clients/
│   ├── web/              # React + Vite browser client
│   │   ├── src/components/
│   │   ├── src/stores/   # Zustand state
│   │   ├── src/hooks/
│   │   └── src/__tests__/
│   └── desktop/          # Tauri shell (loads web dist; also Android + iOS targets)
│
└── docs/                 # Architecture, API spec, deployment guide
```

Full architecture details: [docs/architecture.md](docs/architecture.md)
API reference: [docs/openapi.yaml](docs/openapi.yaml)

---

## Questions?

Open an issue with the `question` label or email jordan@jordanjenkins.com. We're happy to help
you get started.
