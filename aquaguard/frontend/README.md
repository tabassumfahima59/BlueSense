# AquaGuard frontend

Next.js 15 (App Router) client for the AquaGuard API. See the project README (`../README.md`) for full setup.

```bash
npm install
npm run dev          # http://localhost:3000 (expects the API at NEXT_PUBLIC_API_URL, default http://localhost:8001)
npm run build        # production build (copies the MapLibre worker into public/maplibre first)
npm test             # vitest: scenario URL sync, allocation-share rebalancing, formatting
npm run gen:api      # regenerate lib/types/api.d.ts from ../docs/openapi.json
```

`NEXT_PUBLIC_API_MODE=mock` serves the captured responses in `public/mocks/` without a backend.
