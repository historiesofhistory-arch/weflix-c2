# Overview

This project is a pnpm workspace monorepo using TypeScript, designed for building and managing a Netflix-inspired streaming platform. It encompasses an API server, several front-end applications, and shared libraries. The primary goal is to provide a robust, scalable, and feature-rich video streaming experience, leveraging various scraping techniques for content acquisition and a resilient API for content delivery.

The project features two main client applications: a legacy React/Vite streaming app served at `/weflix/` and a newer, primary React/Vite/Tailwind CSS app served at the root `/`. The core of the backend is an Express 5 API server that handles content scraping, stream proxying, and metadata retrieval. The system is built to dynamically adapt to content sources, prioritizing direct access where possible and falling back to various proxy and scraping mechanisms to ensure content availability.

Key capabilities include:
- Multi-source video streaming with smart fallbacks (MovieBox MP4, VidLink HLS, VidSrc HLS, embed iframes).
- Dynamic audio language switching and subtitle support.
- Comprehensive metadata retrieval (IMDB integration, MovieBox BFF).
- User authentication via Firebase and user data persistence with Firestore (watchlist, continue watching).
- Client-side and server-side API interactions with robust error handling and proxying for content providers.

# User Preferences

The user prefers iterative development and asks for confirmation before any major changes are implemented. They prefer clear and concise explanations and expect the agent to use simple language. The user wants the agent to prioritize high-level architectural decisions and system design over granular implementation details when discussing changes or proposals.

# System Architecture

## Core Technologies
- **Monorepo Tool**: pnpm workspaces
- **Language**: TypeScript 5.9
- **Backend Framework**: Express 5
- **Database**: PostgreSQL with Drizzle ORM
- **Frontend Frameworks**: React 18, Vite
- **Styling**: Tailwind CSS v3
- **Validation**: Zod (with `drizzle-zod`)
- **API Codegen**: Orval (from OpenAPI spec)
- **Bundler**: esbuild

## Monorepo Structure
The project is organized into `artifacts/` (deployable applications), `lib/` (shared libraries), and `scripts/` (utility scripts). This structure promotes code reuse and clear separation of concerns.

## TypeScript Configuration
All packages are configured as TypeScript composite projects, extending a shared `tsconfig.base.json`. Typechecking is performed from the monorepo root to ensure correct cross-package dependency resolution. `.d.ts` files are emitted during typecheck, while actual JS bundling is handled by `esbuild` or `Vite`.

## UI/UX and Client Applications

### WeFlix (Legacy)
- Served at `/weflix/`.
- Mobile-first design with a smart header for small screens and a sidebar for desktop.
- `SmartPlayer` component with automatic fullscreen/landscape, supporting MP4 via VidStack (with quality switching) and HLS for scraped streams.
- Audio language selector integrated with `SmartPlayer`.
- MovieDetails and TvDetails pages utilize `SmartPlayer`.

### MovieBox Test ("WeFlix C2" - Primary Application)
- Served at the root URL `/`.
- Netflix-style streaming app, heavily utilizing MovieBox BFF/H5 API for all content data and MP4 streaming.
- UI design inspired by `github.com/kweephyo-pmt/WeFlix_v2` by kaif.
- **Stack**: React 18, Vite, Tailwind CSS, Framer Motion, `@vidstack/react`.
- **Data Flow**: Client-side BFF first (browser fetches directly from `api3.aoneroom.com` after getting signed headers from `/api/bff-sign`), falling back to server-side API if direct access fails.
- **Auth**: Firebase Auth (Google, email/password) with Firestore for user data and preferences (watchlist, continue watching).
- **`SmartPlayer`**: Fullscreen overlay player using `@vidstack/react` with direct CDN MP4 streams, automatic fallback to CF Worker proxy, language switching, and subtitle/captions support via `<Track>` components.
- **Subtitles**: Fetched from `/api/stream/mb-subtitles` (or client BFF `subtitle-search`). Rendered as Vidstack `<Track kind="subtitles">` elements inside `<MediaProvider>`. Supports SRT and VTT formats with auto-detection. Users toggle captions via Vidstack's built-in CC menu.
- **Player Theme**: MovieBox APK-inspired dark cinematic CSS theme — custom slider styling (#c45454 brand), frosted glass menus, styled caption cues with text shadows, and responsive safe-area padding.
- **Content Model**: Relies on MovieBox `subjectId`, `subjectType`, and image URLs.
- **Detail Pages**: Netflix-style with full-bleed backdrops, tabs for episodes/details/cast, and season/episode selectors for TV series.
- **Pages**: Home (hero banner, carousels), Movies/Series (search-based grids), Search (infinite scroll), Movie/Tv Details, Watchlist.
- **SEO**: Integrated via `react-helmet-async`.
- **Smoothness primitives** (Task #113 polish baseline; all under `src/components/`):
    - `Skeleton` — shimmering placeholder; used in TrendingRow, ContentCard, HomePage row skeletons, ContentGrid, and DetailPageSkeleton (all ad-hoc `animate-pulse` divs replaced).
    - `Toast` (`ToastProvider` + `useToast()`) — iOS-style stack mounted in `main.jsx`. Used by `WatchlistContext` (add/remove feedback) and `AuthModal` (sign-in / Google / password-reset success + error). `window.__toast` bridge available for non-React modules.
    - `BottomSheet` — drag-to-dismiss mobile sheet / desktop modal. `AuthModal` consumes it.
    - `ScrollToTopButton` — extracted from `ParentComponent`; configurable `showAfter` threshold.
- **Scroll/image perf baseline** (Task #117 + iOS-smooth pass):
    - Native scroll only — no global `scroll-behavior: smooth`. Programmatic `scrollTo({ behavior: 'smooth' })` (e.g. `ScrollToTopButton`, row arrow buttons) still works.
    - Card classes (`.pcw-card`, `.card-hover-lift`) carry `transition: transform` but **no** always-on `will-change` (avoids per-card layer-explosion).
    - Horizontal carousel rows use `.card-row` with `touch-action: pan-x` so they only claim sideways gestures; cards inside use `touch-action: pan-y pinch-zoom` so a finger that lands on a poster still scrolls the page vertically. Inner control buttons (watchlist `+`) keep `touch-action: manipulation`. Trending row uses `snap-proximity` (not `mandatory`) for a softer iOS-style snap.
    - Poster fade-in is opacity + 1.01 → 1 scale only — the `filter: blur(6px)` pass was removed (it caused mobile-GPU jank during scroll).
    - `html, body { overscroll-behavior-y: contain; }` so only the document edges rubber-band, not every inner scroller.
    - Hero banner skeleton uses one shared `Skeleton` block (one shimmer timer) instead of six concurrent `animate-pulse` divs.
    - `content-visibility: auto` was tried on off-screen rows but caused jumpy/stuck scrolling on iOS WebView and was reverted. The `.row-deferred` class still exists but is a no-op; off-screen-only deferral is on hold until we can gate it behind a feature flag.
    - Eager / `fetchPriority="high"` poster loading is restricted to the first 5 cards of the first row only; everything else is `loading="lazy"`. `<img>` carries intrinsic `width={300} height={450}`.
    - `HeroBanner` slide-rotation `setInterval` is paused via `IntersectionObserver` when the hero scrolls out of view, and via `visibilitychange` when the tab is hidden.
    - Route cross-fade is opacity-only (180ms `easeOut`, no `y` translate); `useReducedMotion` still bypasses the animation.
    - `mbCoverUrl(url, width)` keeps its width param for forward-compat but currently returns the URL unchanged — the MovieBox CDN does not expose a documented resize query string.
- **Progress + transitions** (Task #113):
    - `context/ProgressContext` provides `useProgressWhile(loading)` wired into HomePage (`fetchHome` + genre fetch), MovieDetails, TvDetails, and SearchPage so the top bar reflects real fetch lifecycles. `App.jsx`'s lazy-route Suspense fallback also pushes/pops the same counter.
    - `ContentCard` triggers `document.startViewTransition` with a `poster-{mediaId}` view-transition-name; matching name on the hero `<img>` of MovieDetails / TvDetails morphs the poster into the hero on supporting browsers. Honours `prefers-reduced-motion`.
    - `ParentComponent` cross-fades routes via `AnimatePresence` + `useNavigationType` for direction-aware transitions.

## API Server (`api-server`)

- Express 5 server handling all API endpoints.
- Routes are organized in `src/routes/` and use `@workspace/api-zod` for request/response validation and `@workspace/db` for persistence.
- **Stream Sourcing**: Implements a waterfall approach for finding stream sources: MovieBox MP4 (BFF/H5) → VidLink HLS → VidSrc HLS → embed iframe.
- **MovieBox Scrapers**: Sophisticated scraping logic for MovieBox BFF (mobile API with HMAC signing, direct datacenter IP access with India proxy fallback) and H5 (guest token). Includes logic for resolving language variants, seasons, and subtitles.
- **IMDB Integration**: Resolves TMDB ID to IMDB ID to fetch OMDB metadata (title, year, rating, votes) for improved MovieBox search accuracy.
- **BFF Auth**: Solved email login with MD5-hashed password to obtain JWTs for accessing authenticated BFF endpoints. Includes an auth token caching and refresh mechanism.
- **BFF Request Cascade**: Automatically probes direct access to `api3.aoneroom.com` and falls back to India-based HTTP proxies if direct access is blocked. If both fail, fetches H5 guest token via Cloudflare Worker (`h5-token-proxy.popcorntv-proxy.workers.dev`). CF Worker deployed using `CLOUDFLARE_API_TOKEN` on account `6adb999bffd33abc3b2437ca58014534`.
- **BFF Resource API**: Integrates with MovieBox's community-uploaded stream API (`/wefeed-mobile-bff/subject-api/resource`) for additional MP4 streams and subtitles.
- **Proxy**: Includes a transparent proxy endpoint (`/api/stream/proxy`) for HLS m3u8 playlists and TS segments.
- WASM files are copied to `dist/scrapers/` during build for `vidlink` scraper.

## Database Layer (`lib/db`)

- Uses Drizzle ORM with PostgreSQL.
- Exports a Drizzle client instance and schema models.
- Drizzle Kit is used for migrations (automated in Replit production, `push`/`push-force` in development).

## API Specification and Codegen (`lib/api-spec`)

- Manages the OpenAPI 3.1 specification (`openapi.yaml`).
- Orval configuration generates:
    - React Query hooks and a fetch client into `lib/api-client-react/src/generated/`.
    - Zod schemas into `lib/api-zod/src/generated/`.

# External Dependencies

- **PostgreSQL**: Primary database for persistence (managed by Drizzle ORM).
- **MovieBox API (BFF/H5)**: Primary content source (scraped).
    - `api3.aoneroom.com`, `h5-api.aoneroom.com`, `pbcdnw.aoneroom.com`, `bcdn.hakunaymatata.com`.
- **VidLink**: HLS stream source (scraped, uses Go WASM + libsodium).
- **VidSrc**: HLS stream source (cheerio-based scraping).
- **OMDB API**: For retrieving IMDB metadata (requires `OMDB_API_KEY`).
- **Firebase Auth**: User authentication (Google, email/password).
- **Firestore**: User data storage (watchlist, continue watching).
- **CF Worker Stream Proxy (`weflix-stream-proxy`)**: Proxies video CDN requests with correct Referer header for production streaming. URL: `https://weflix-stream-proxy.popcorntv-proxy.workers.dev/`. Set via `CF_STREAM_PROXY_URL` (production only).
- **CF Worker Stream Proxy — Koyeb dedicated (`popcorntv-koyeb-stream-proxy`)**: Same code as `weflix-stream-proxy`, deployed as a separate worker so the Koyeb deployment owns its own stream proxy. URL: `https://popcorntv-koyeb-stream-proxy.popcorntv-proxy.workers.dev/`. Set this in the Koyeb env as `STREAM_PROXY_URL` (or `CF_STREAM_PROXY_URL`). Deploy/update via `scripts/deploy-cf-koyeb-stream-worker.sh`.
- **CF Worker Subtitle Proxy — Koyeb dedicated (`popcorntv-koyeb-subtitle-proxy`)**: Proxies subtitle (.vtt/.srt) downloads with CORS so the browser `<track>` element can load them. Same code as the stream worker. URL: `https://popcorntv-koyeb-subtitle-proxy.popcorntv-proxy.workers.dev/`. Set in Koyeb env as `SUBTITLE_PROXY_URL` (or `CF_SUBTITLE_PROXY_URL`). When set, the API server automatically rewraps every subtitle URL it returns to the front-end through this proxy. Deploy/update via `scripts/deploy-cf-koyeb-subtitle-worker.sh`.
- **CF Worker BFF Proxy (`weflix-bff-proxy`)**: Reverse-proxies BFF API calls from production server to `api3.aoneroom.com` (bypasses datacenter IP blocks). URL: `https://weflix-bff-proxy.popcorntv-proxy.workers.dev`. Set via `BFF_PROXY_URL` (production only). Auth via `X-Auth-Key` header.
- **Cloudflare Worker (`h5-token-proxy`)**: Deployed on `popcorntv-proxy.workers.dev`, fetches H5 guest tokens from `h5-api.aoneroom.com` for production auth. URL stored in `CF_H5_WORKER_URL` env var.
- **Proxifly**: Free proxy list fallback for BFF requests when CF Worker is unavailable (last resort).
- **`@vidstack/react`**: Video player library for frontend.
- **`libsodium-wrappers`**: Used by `vidlink` scraper.
- **`cheerio`**: Used by `vidsrc` scraper.
- **`undici`**: For HTTP requests and ProxyAgent in the API server.
