# Sanktan ⚽

Laguppställningsverktyg för 5v5-fotboll med ungdomar.

- Hantera spelartrupp med målvakter och positionspreferenser
- Generera rättvisa matchplaner automatiskt
- Byt runt spelare med ett tryck
- Speltidsöversikt per spelare

**Live:** https://borickard.github.io/Sanktan/

## Dela kort länk (Upstash Redis)

Knappen "Dela kort länk" sparar matchplanen i Upstash Redis och ger en kort URL (`?c=ABC123`) som inte går sönder när den delas i WhatsApp eller andra chattappar. Koden består av 6 tecken och har 30 dagars TTL.

API-rutterna (`api/save.js`, `api/load.js`) är Vercel serverless functions och kräver en Upstash Redis-databas.

### Installation

1. Skapa en databas på [console.upstash.com/redis](https://console.upstash.com/redis) (gratisnivån räcker gott).
2. Kopiera **REST URL** och **REST Token**.
3. Lägg in dem som miljövariabler:
   - **Lokalt:** `cp .env.example .env.local` och fyll i värdena.
   - **Vercel:** lägg till `UPSTASH_REDIS_REST_URL` och `UPSTASH_REDIS_REST_TOKEN` under Project Settings → Environment Variables (Production + Preview).
4. Deploya till Vercel. API-rutterna finns då på `/api/save` och `/api/load`.

> GitHub Pages stöder inte serverless functions, så den korta länken fungerar bara på Vercel-domänen.
