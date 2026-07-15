# 📍 GeoTag Photo

A dependency-free Progressive Web App that turns your phone (or laptop) into a
geotagging camera. Every photo you capture gets a panel stamped onto it showing:

- **Lat/long coordinates** (with GPS accuracy)
- **Reverse-geocoded address / place name** (via OpenStreetMap Nominatim)
- **Date & time** of capture
- **A mini map thumbnail** of the location (OpenStreetMap tiles)
- **An optional remark** you type in before shooting

The result is a single JPEG you can save or share — like the popular
"GPS Map Camera" apps, but running entirely in the browser.

## Run it locally

The Camera and Geolocation APIs require a **secure context**, so use
`http://localhost` (treated as secure) or HTTPS — not `file://`.

```bash
cd "GeoTag Capture"
npx serve .            # or: python3 -m http.server 8000
```

Then open the printed URL (e.g. http://localhost:3000) and allow **camera** and
**location** access when prompted.

> On a phone you'll need HTTPS. Easiest path: deploy the folder to any static
> host (GitHub Pages, Netlify, Vercel, Cloudflare Pages) and open it there, or
> tunnel localhost over HTTPS (e.g. `ngrok http 3000`).

## Install as an app

Once served over HTTPS, your browser will offer **Add to Home Screen / Install**.
The app runs standalone and the shell works offline (map tiles and address
lookups still need a connection).

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Markup: camera stage, live overlay, capture/result views |
| `styles.css` | Layout and overlay styling |
| `app.js` | Camera, geolocation, reverse geocoding, mini-map, capture compositing |
| `manifest.webmanifest` | PWA metadata |
| `service-worker.js` | Offline app-shell cache (tiles/geocoding stay network-only) |
| `generate-icons.js` | Regenerates the PNG app icons (`node generate-icons.js`) |
| `icons/` | App icons |

## How capture works

The live video frame is drawn to a canvas at full sensor resolution, then the
geotag panel — coordinates, address, time, remark and a re-rendered mini map —
is composited on top and exported as JPEG. The on-screen overlay is just a
preview; the stamped data is baked into the saved image.

## Notes & limits

- **Reverse geocoding** uses the free public Nominatim endpoint, which has a
  usage policy (≤1 request/sec). Lookups are throttled and only re-run when you
  move. For production use, host your own Nominatim or use a commercial geocoder.
- **Map tiles** come from the public OpenStreetMap tile servers — fine for
  development; use your own tile provider for anything heavy.
- GPS accuracy depends on the device. Desktops without GPS fall back to
  IP/Wi-Fi based location, which can be coarse.
