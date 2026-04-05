# Together Documentation Site

Built with [VitePress](https://vitepress.dev/). Served at https://docs.together-chat.com.

## Local Development

```bash
npm install
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Build for production
npm run preview      # Preview production build
```

## Deploy

```bash
../../scripts/deploy-docs.sh user@your-server

Or set env var:
```bash
REMOTE_HOST=user@your-server ../../scripts/deploy-docs.sh
```

## Structure

- `docs/` — Markdown source files
  - `features/` — Feature documentation
  - `guides/` — Self-hosting, admin, and setup guides
  - `reference/` — API and protocol reference
- `.vitepress/config.mjs` — Site configuration, sidebar, navigation
- `.vitepress/theme/` — Custom theme overrides (dark purple brand)
- `public/` — Static assets (logo, etc.)
