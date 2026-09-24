# $SMOL — samma karaktär, format "world"

SMOL bor på en flytande ö i himlen. Man går runt med honom (WASD/piltangenter, klick/tap på marken, eller klick på en plats eller i minikartan). Kameran följer efter och kan vridas genom att dra; scroll = zoom. Står han still vänder han sig mot kameran.

## Kör
Dubbelklicka `start.bat` (första gången kör den `npm install`) → öppnar http://localhost:5173.
Bygg för hosting: `npm run build` → `dist/` (statiskt, funkar på Vercel/Netlify/Cloudflare Pages).

## Platser på ön
| Plats | Öppnar |
|---|---|
| SMOL:s hus (öron på taket) | ABOUT |
| Utomhusbio (memes rullar på duken) | MEMES |
| Mjölkståndet | HOW TO BUY |
| Fyren med teleskop | CHART (Dexscreener när CA finns) |
| Brevlådan längst ut på bryggan | X |
| SMOL | reagerar (vinkar/dansar/hoppar), pratbubbla, konfetti |

Gå fram till en plats → knappen **E / open …** dyker upp. Dockan längst ned får SMOL att springa dit och öppna sektionen.

## Ändra
Allt bor i `src/site.config.ts`:
- `world.kind`: `"sky"` (flytande ö över molnhav) eller `"sea"` (ö i ett lågpoly-hav med strand).
- `world.radius`, färger för gräs/stig/klippor (`ground`), himmel, moln/hav, ljus, kamera, brygga (`pier.angle`), blommor/tuvor/stenar.
- `props`: platser = props med `open`. Utelämna `rotY` så vänds de mot mitten, och stigarna ritas automatiskt.
- CA (`ca: ""` = "coming soon"), länkar, lore, how-to-buy, pratbubblor, palett, fonter.

## AI-genererade assets (Higgsfield)
- Karaktär + klipp (idle, walk, wave, dance, jump): samma T-pose-riggade SMOL som i rummet.
- Nya ö-props: hus, mjölkstånd, bio, fyr, palm (nano banana → Tripo H3.1, texturer krympta) i `public/models/props/`. Mjölk, kartong, växt och garn återanvända från rummet.
- Ön, himlen, molnen, bryggan, brevlådan, blommorna och grästuvorna är procedurella (kod, inga bildfiler).

Ingen musik ännu — lägg en loop i `public/audio/theme.mp3` och sätt `music: "/audio/theme.mp3"`.
