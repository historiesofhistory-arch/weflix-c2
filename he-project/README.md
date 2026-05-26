# CineBot — H2

Telegram bot + CineBot Player mini app + API server, powered by MovieBox BFF/H5 APIs.

## Architecture

| Service | Description | Directory |
|---------|-------------|-----------|
| **API Server** | Express API that proxies MovieBox streams, search, and language data. Also serves the Player frontend as static files. | `artifacts/api-server/` |
| **CineBot Player** | React (Vite) mini app with vidstack player — opened from Telegram. Built to static files and served by the API server. | `artifacts/cinebot-app/` |
| **Telegram Bot** | Grammy bot that handles `/start`, inline search, and launches the player. | `artifacts/tg-bot/` |

## Deployment on Render

This repo includes a `render.yaml` Blueprint that defines two Render services:

| Render Service | Type | Description |
|----------------|------|-------------|
| `cinebot-api` | Web | API server + Player static site (builds both, serves frontend from `/`) |
| `cinebot-telegram-bot` | Worker | Telegram bot (connects to the API server via `API_BASE_URL`) |

> **Note:** The Player frontend is intentionally bundled into the API web service (not a separate static site) because the API server already serves the built Vite output from `dist/public` — a third service would be redundant.

### Quick Start

1. Fork or import this repo into your Render dashboard.
2. Click **New > Blueprint** and select this repo.
3. Set the required environment variables in the Render dashboard:

| Variable | Service | Required | Description |
|----------|---------|----------|-------------|
| `MOVIEBOX_EMAIL` | cinebot-api | Yes | MovieBox account email |
| `MOVIEBOX_PASSWORD` | cinebot-api | Yes | MovieBox account password |
| `MOVIEBOX_BFF_SECRET` | cinebot-api | No | BFF API secret (uses default if not set) |
| `PLAYER_URL` | cinebot-api | No | Override the player URL the bot sends to users |
| `TELEGRAM_BOT_TOKEN` | cinebot-telegram-bot | Yes | Bot token from @BotFather |
| `API_BASE_URL` | cinebot-telegram-bot | Yes | API server URL **with `/api` suffix**, e.g. `https://cinebot-api.onrender.com/api` |
| `PLAYER_URL` | cinebot-telegram-bot | Yes | Player URL — same as API server root, e.g. `https://cinebot-api.onrender.com/` |

4. Deploy. The API health check endpoint is `/api/healthz`.

### How the build works

**cinebot-api (web service):**
1. `pnpm install` installs all workspace dependencies
2. Builds the API server with esbuild (`artifacts/api-server/dist/index.mjs`)
3. Builds the CineBot Player with Vite (`BASE_PATH=/`, output in `artifacts/cinebot-app/dist/public`)
4. Copies the frontend static files into the API server's dist directory
5. Starts the API server which serves both the API and the static frontend

**cinebot-telegram-bot (worker service):**
1. `pnpm install` installs all workspace dependencies
2. Runs the bot directly with Node.js — no build step needed
3. Set `API_BASE_URL` to the API server's external URL with `/api` suffix (e.g. `https://cinebot-api.onrender.com/api`)
4. Set `PLAYER_URL` to the API server's root URL (e.g. `https://cinebot-api.onrender.com/`) — this is where the player frontend is served

### Hugging Face Spaces

This project is also deployed on [Hugging Face Spaces](https://huggingface.co/spaces/Botnest/cinebot-player) as a Docker-based Space.

To deploy your own:
1. Create a new Docker Space on Hugging Face
2. Push this repo (use `HF_README.md` as the repo's `README.md`)
3. Add the required secrets in the Space settings: `MOVIEBOX_EMAIL`, `MOVIEBOX_PASSWORD`, `MOVIEBOX_BFF_SECRET`, `TELEGRAM_BOT_TOKEN`, `USE_CF_PROXY=true`
4. The Space will build the Docker container and start automatically on port 7860

### Docker Alternative

A `Dockerfile` and `start.sh` are also included for single-container deployment (e.g., on Railway, Fly.io, or self-hosted). The Docker build combines all three services into one container.

## Local Development

```bash
pnpm install
# Terminal 1 — API server
pnpm --filter @workspace/api-server run dev
# Terminal 2 — CineBot Player (Vite dev server)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/cinebot-app run dev
# Terminal 3 — Telegram bot
API_BASE_URL=http://localhost:8080/api pnpm --filter @workspace/tg-bot run start
```

## Project Structure

```
├── artifacts/
│   ├── api-server/        # Express API (esbuild bundled)
│   ├── cinebot-app/       # React + Vite player UI
│   └── tg-bot/            # Grammy Telegram bot
├── lib/
│   ├── api-client-react/  # Generated API client hooks
│   ├── api-spec/          # OpenAPI spec + orval codegen
│   ├── api-zod/           # Shared Zod schemas
│   └── db/                # Drizzle schema (not used on Render)
├── Dockerfile             # Single-container alternative
├── render.yaml            # Render Blueprint (2 services)
├── start.sh               # Docker entrypoint
└── pnpm-workspace.yaml
```
