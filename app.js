'use strict';

/* ----------------------------------------------------------------
   GeoTag Photo — vanilla JS PWA
   Stamps GPS coords, reverse-geocoded address, time, an optional
   remark, and a mini OSM map onto each captured photo.
-----------------------------------------------------------------*/

const els = {
  status:    document.getElementById('status'),
  video:     document.getElementById('video'),
  mapCanvas: document.getElementById('mapCanvas'),
  ovAddress: document.getElementById('ovAddress'),
  ovCoords:  document.getElementById('ovCoords'),
  ovExtra:   document.getElementById('ovExtra'),
  ovTime:    document.getElementById('ovTime'),
  ovRemark:  document.getElementById('ovRemark'),
  ovMap:     document.querySelector('.overlay-map'),
  logoOverlay: document.getElementById('logoOverlay'),
  remark:    document.getElementById('remark'),
  shutter:   document.getElementById('shutter'),
  flipBtn:   document.getElementById('flipBtn'),
  locBtn:    document.getElementById('locBtn'),
  cameraView:  document.getElementById('cameraView'),
  resultView:  document.getElementById('resultView'),
  resultImg:   document.getElementById('resultImg'),
  resultRemark: document.getElementById('resultRemark'),
  resultProject: document.getElementById('resultProject'),
  resultTags:  document.getElementById('resultTags'),
  projectList: document.getElementById('projectList'),
  retakeBtn:   document.getElementById('retakeBtn'),
  saveBtn:     document.getElementById('saveBtn'),
  shareBtn:    document.getElementById('shareBtn'),
  captureCanvas: document.getElementById('captureCanvas'),
  historyBtn:  document.getElementById('historyBtn'),
  historyView: document.getElementById('historyView'),
  historyBack: document.getElementById('historyBack'),
  historyGrid: document.getElementById('historyGrid'),
  historyEmpty: document.getElementById('historyEmpty'),
  exportCsv:   document.getElementById('exportCsv'),
  exportGeo:   document.getElementById('exportGeo'),
  projectFilter: document.getElementById('projectFilter'),
  mapBtn:      document.getElementById('mapBtn'),
  mapView:     document.getElementById('mapView'),
  mapBack:     document.getElementById('mapBack'),
  capturesMap: document.getElementById('capturesMap'),
  mapEmpty:    document.getElementById('mapEmpty'),
  lightbox:    document.getElementById('lightbox'),
  lightboxImg: document.getElementById('lightboxImg'),
  lbClose:     document.getElementById('lbClose'),
  lbShare:     document.getElementById('lbShare'),
  lbDelete:    document.getElementById('lbDelete'),
  overlay:      document.getElementById('overlay'),
  settingsBtn:  document.getElementById('settingsBtn'),
  settingsView: document.getElementById('settingsView'),
  settingsBack: document.getElementById('settingsBack'),
  templateOpts: document.getElementById('templateOpts'),
  accentOpts:   document.getElementById('accentOpts'),
  logoInput:    document.getElementById('logoInput'),
  logoPreview:  document.getElementById('logoPreview'),
  logoRemove:   document.getElementById('logoRemove'),
  logoToggle:   document.getElementById('logoToggle'),
};

const state = {
  stream: null,
  facing: 'environment',
  geo: null,           // { lat, lon, accuracy }
  address: null,       // human-readable string
  addressFor: null,    // { lat, lon } the address actually describes
  mapTile: null,       // Image element for the loaded map tile
  mapMarker: null,     // { x, y } marker pixel offset within the 120px canvas
  watchId: null,
  lastBlobUrl: null,
  capture: null,       // immutable snapshot of the current shot
  weather: null,       // { temp, code } from Open-Meteo
  plusCode: null,      // Open Location Code for the current fix
};

const MAP_ZOOM = 16;
const MAP_PX = 120; // canvas size for mini map

// True when running inside the Capacitor native shell (iOS / Android).
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform());
const CapGeo = isNative ? window.Capacitor.Plugins.Geolocation : null;
const CapFS  = isNative ? window.Capacitor.Plugins.Filesystem  : null;

function setStatus(msg) { els.status.textContent = msg; }

/* ---------------- Settings (persisted) ---------------- */

const SETTINGS_KEY = 'geotag-settings';
const DEFAULT_SETTINGS = {
  template: 'card',          // 'card' | 'bar' | 'minimal'
  accent: '#38bdf8',
  fields: {
    map: true, address: true, coords: true, altSpeed: true,
    weather: true, plusCode: true, datetime: true, remark: true,
  },
  logo: null,                // data URL string
  showLogo: false,
  lastProject: '',           // pre-fills the project field on the next capture
  overlayPos: null,          // { x, y } px from top-left of camera view, null = default
};

let settings = loadSettings();
let logoImg = null;          // decoded logo Image for canvas drawing

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      ...DEFAULT_SETTINGS, ...raw,
      fields: { ...DEFAULT_SETTINGS.fields, ...(raw.fields || {}) },
    };
  } catch { return { ...DEFAULT_SETTINGS, fields: { ...DEFAULT_SETTINGS.fields } }; }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

// Load the logo data URL into an Image so the canvas can draw it.
function loadLogoImage() {
  if (!settings.logo) { logoImg = null; return; }
  const img = new Image();
  img.onload = () => { logoImg = img; renderOverlay(); };
  img.onerror = () => { logoImg = null; };
  img.src = settings.logo;
}

// Reflect settings into CSS, the live overlay, the logo layer and the
// settings UI controls. Called on boot and whenever a setting changes.
function applySettings() {
  document.documentElement.style.setProperty('--accent', settings.accent);

  // Logo preview layer over the camera.
  if (settings.logo) {
    els.logoOverlay.src = settings.logo;
    els.logoPreview.src = settings.logo;
    els.logoPreview.classList.remove('hidden');
    els.logoRemove.classList.remove('hidden');
  } else {
    els.logoPreview.classList.add('hidden');
    els.logoRemove.classList.add('hidden');
  }
  els.logoOverlay.classList.toggle('hidden', !(settings.showLogo && settings.logo));

  // Settings UI active states.
  els.templateOpts.querySelectorAll('.seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.template === settings.template));
  els.accentOpts.querySelectorAll('.swatch').forEach((b) =>
    b.classList.toggle('active', b.dataset.accent === settings.accent));
  document.querySelectorAll('#settingsView input[data-field]').forEach((c) => {
    c.checked = !!settings.fields[c.dataset.field];
  });
  els.logoToggle.checked = settings.showLogo;

  renderOverlay();
}

/* ---------------- Camera ---------------- */

async function startCamera() {
  stopCamera();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    els.video.srcObject = state.stream;
    setStatus('camera ready');
  } catch (err) {
    setStatus('camera blocked');
    els.ovAddress.textContent = 'Camera access denied';
    console.error(err);
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
}

/* ---------------- Geolocation ---------------- */

function startGeo() {
  if (isNative) {
    if (state.watchId !== null) CapGeo.clearWatch({ id: state.watchId });
    CapGeo.watchPosition({ enableHighAccuracy: true }, (pos, err) => {
      if (err) {
        setStatus('location blocked');
        els.ovAddress.textContent = 'Location unavailable';
        console.error(err);
      } else {
        onPosition(pos);
      }
    }).then((id) => { state.watchId = id; });
    return;
  }
  if (!('geolocation' in navigator)) {
    els.ovAddress.textContent = 'Geolocation unsupported';
    return;
  }
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = navigator.geolocation.watchPosition(
    onPosition,
    (err) => {
      setStatus('location blocked');
      els.ovAddress.textContent = 'Location unavailable';
      console.error(err);
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
}

let lastGeocodeAt = 0;
let lastWeatherAt = 0;
function onPosition(pos) {
  const { latitude, longitude, accuracy, altitude, speed, heading } = pos.coords;
  const moved = !state.geo ||
    Math.abs(state.geo.lat - latitude) > 1e-4 ||
    Math.abs(state.geo.lon - longitude) > 1e-4;
  // altitude/speed/heading are null when the device can't determine them.
  state.geo = { lat: latitude, lon: longitude, accuracy, altitude, speed, heading };
  state.plusCode = OpenLocationCode.encode(latitude, longitude, 11);
  renderOverlay();

  if (moved) {
    loadMapTile(latitude, longitude);
    const now = Date.now();
    // Throttle reverse-geocoding to respect Nominatim usage policy.
    if (now - lastGeocodeAt > 8000) {
      lastGeocodeAt = now;
      updateAddressFromFix(latitude, longitude);
    }
    if (now - lastWeatherAt > 60000) {
      lastWeatherAt = now;
      updateWeather(latitude, longitude);
    }
  }
}

// Current conditions from Open-Meteo (free, no API key).
async function updateWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('weather ' + res.status);
    const d = await res.json();
    const c = d.current;
    state.weather = { temp: Math.round(c.temperature_2m), code: c.weather_code };
    renderOverlay();
  } catch (err) {
    console.warn('weather fetch failed', err);
  }
}

// WMO weather code -> short label + emoji.
function weatherLabel(code) {
  if (code == null) return null;
  const map = {
    0: '☀ Clear', 1: '🌤 Mainly clear', 2: '⛅ Partly cloudy', 3: '☁ Overcast',
    45: '🌫 Fog', 48: '🌫 Rime fog', 51: '🌦 Light drizzle', 53: '🌦 Drizzle',
    55: '🌧 Dense drizzle', 61: '🌦 Light rain', 63: '🌧 Rain', 65: '🌧 Heavy rain',
    71: '🌨 Light snow', 73: '🌨 Snow', 75: '❄ Heavy snow', 80: '🌦 Showers',
    81: '🌧 Showers', 82: '⛈ Violent showers', 95: '⛈ Thunderstorm',
    96: '⛈ Thunderstorm', 99: '⛈ Hailstorm',
  };
  return map[code] || '🌡';
}

async function reverseGeocode(lat, lon) {
  // On native iOS use Apple's CLGeocoder — accurate pincodes, no API key needed.
  if (isNative && window.Capacitor.Plugins.NativeGeocoder) {
    try {
      const r = await window.Capacitor.Plugins.NativeGeocoder.reverseGeocode({
        latitude: lat, longitude: lon,
      });
      const parts = [
        r.thoroughfare,
        r.subLocality,
        r.locality || r.subAdministrativeArea,
        r.administrativeArea,
        r.postalCode,
        r.country,
      ].filter(Boolean).filter((p, i, arr) => p !== arr[i - 1]);
      state.address = parts.join(', ') || null;
      state.addressFor = { lat, lon };
      return state.address;
    } catch (err) {
      console.warn('CLGeocoder failed, falling back to Nominatim', err);
    }
  }

  // Web fallback: Nominatim for the address structure, then async postcode lookup.
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('geocode ' + res.status);
  const data = await res.json();
  const a = data.address || {};
  const parts = [
    a.road || a.pedestrian || a.footway,
    a.neighbourhood || a.hamlet,
    a.village || a.suburb,
    a.city_district || a.county,
    a.city || a.town || a.municipality,
    a.state,
    a.country,
  ].filter(Boolean).filter((p, i, arr) => p !== arr[i - 1]);

  state.address = parts.join(', ') || data.display_name || null;
  state.addressFor = { lat, lon };

  // Postcode: Overpass first (tagged on buildings/roads), then validated Nominatim.
  const nominatimPc = postcodeValidForState(a.postcode, a['ISO3166-2-lvl4'])
    ? (a.postcode || null) : null;

  const appendPostcode = (pc) => {
    if (!pc || !state.addressFor) return;
    if (Math.abs(state.addressFor.lat - lat) > 1e-5) return;
    const before = parts.slice(0, -1);
    const country = parts[parts.length - 1];
    state.address = [...before, pc, country].filter(Boolean).join(', ');
    renderOverlay();
  };
  fetchNearbyPostcode(lat, lon).then((pc) => appendPostcode(pc || nominatimPc))
                               .catch(() => appendPostcode(nominatimPc));

  return state.address;
}

// Query Overpass for the nearest feature that has an explicit addr:postcode tag.
// These are set by local contributors on individual buildings/roads and are
// independent of the administrative boundary polygons Nominatim uses.
// Tries 300 m first; expands to 800 m on no result.
async function fetchNearbyPostcode(lat, lon) {
  for (const radius of [300, 800]) {
    const q = `[out:json][timeout:8];`
      + `(node(around:${radius},${lat},${lon})["addr:postcode"];`
      + ` way(around:${radius},${lat},${lon})["addr:postcode"];);`
      + `out 1;`;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) continue;
      const d = await res.json();
      const pc = d.elements?.[0]?.tags?.['addr:postcode'];
      if (pc) return pc;
    } catch { /* try next radius */ }
  }
  return null;
}

// Known pincode prefix ranges per Indian state (ISO 3166-2 code).
// Used to reject postcodes from misaligned OSM boundary polygons —
// a common problem near state borders where a neighbouring state's
// boundary overlaps and Nominatim returns the wrong postcode.
const IN_STATE_PREFIXES = {
  'IN-DL': [11],
  'IN-HR': [12, 13],
  'IN-PB': [14, 15, 16],
  'IN-CH': [16],
  'IN-HP': [17],
  'IN-JK': [18, 19],
  'IN-LA': [19],
  'IN-UK': [24, 25],
  'IN-UP': [20, 21, 22, 23, 24, 25, 26, 27, 28],
  'IN-RJ': [30, 31, 32, 33, 34],
  'IN-GJ': [36, 37, 38, 39],
  'IN-MH': [40, 41, 42, 43, 44],
  'IN-MP': [45, 46, 47, 48],
  'IN-CG': [49],
  'IN-AP': [50, 51, 52, 53],
  'IN-TG': [50, 51, 52, 53],
  'IN-KA': [56, 57, 58, 59],
  'IN-TN': [60, 61, 62, 63, 64],
  'IN-PY': [60, 67],
  'IN-KL': [67, 68, 69],
  'IN-OR': [75, 76, 77],
  'IN-WB': [70, 71, 72, 73, 74],
  'IN-BR': [80, 81, 82, 83, 84, 85],
  'IN-JH': [81, 82, 83, 84, 85],
  'IN-AS': [78],
};

// Returns true if postcode is plausible for the given ISO 3166-2 state code.
// For non-Indian addresses (no stateCode in our map) we trust the postcode.
function postcodeValidForState(postcode, stateCode) {
  if (!postcode || !stateCode) return true;
  const prefixes = IN_STATE_PREFIXES[stateCode];
  if (!prefixes) return true; // not an Indian state we know — trust it
  const twoDigit = Math.floor(parseInt(postcode, 10) / 10000);
  return prefixes.includes(twoDigit);
}

function updateAddressFromFix(lat, lon) {
  reverseGeocode(lat, lon)
    .then(() => renderOverlay())
    .catch((err) => console.warn('reverse geocode failed', err));
}

/* ---------------- Mini map (OSM tile) ---------------- */

function lonLatToTilePixel(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  const xf = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { xf, yf, xtile: Math.floor(xf), ytile: Math.floor(yf) };
}

function loadMapTile(lat, lon) {
  const { xf, yf, xtile, ytile } = lonLatToTilePixel(lat, lon, MAP_ZOOM);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    state.mapTile = img;
    // pixel position of the marker inside the 256px tile
    state.mapMarker = { px: (xf - xtile) * 256, py: (yf - ytile) * 256 };
    renderMiniMap(els.mapCanvas, MAP_PX);
  };
  img.onerror = () => { state.mapTile = null; };
  const sub = ['a', 'b', 'c'][Math.floor(Math.random() * 3)];
  img.src = `https://${sub}.tile.openstreetmap.org/${MAP_ZOOM}/${xtile}/${ytile}.png`;
}

// Draw the loaded tile centered on the marker, with a pin, into a square canvas.
// `tile`/`marker` default to the live fix but can be a frozen capture's map.
function renderMiniMap(canvas, size, tile = state.mapTile, marker = state.mapMarker) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!tile || !marker) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const { px, py } = marker;
  const scale = canvas.width / size; // support hi-res draw
  // Source rect: a `size`-px window of the tile centered on the marker.
  const half = size / 2;
  const sx = px - half, sy = py - half;
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tile, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
  // marker pin at center
  const cx = canvas.width / 2, cy = canvas.height / 2;
  ctx.fillStyle = '#ef4444';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.arc(cx, cy, 6 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/* ---------------- Overlay rendering ---------------- */

function fmtCoords(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lon).toFixed(5)}° ${ew}`;
}

function fmtTime(d) {
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// Compact one-line summary of the extra sensor/weather/Plus Code data,
// filtered by which fields are enabled. Pulls from a snapshot if given.
function fmtExtra(src, fields) {
  const f = fields || settings.fields;
  const geo = src ? src.geo : state.geo;
  const weather = src ? src.weather : state.weather;
  const plus = src ? src.plusCode : state.plusCode;
  const parts = [];
  if (f.altSpeed && geo && typeof geo.altitude === 'number' && isFinite(geo.altitude)) {
    parts.push(`▲ ${Math.round(geo.altitude)}m`);
  }
  if (f.altSpeed && geo && typeof geo.speed === 'number' && isFinite(geo.speed) && geo.speed > 0.3) {
    parts.push(`${Math.round(geo.speed * 3.6)} km/h`);
  }
  if (f.weather && weather) parts.push(`${weather.temp}°C ${weatherLabel(weather.code)}`);
  if (f.plusCode && plus) parts.push(plus);
  return parts.join('  ·  ');
}

function renderOverlay() {
  const f = settings.fields;
  if (state.geo) {
    els.ovCoords.textContent =
      fmtCoords(state.geo.lat, state.geo.lon) + `  ±${Math.round(state.geo.accuracy)}m`;
    if (!state.address) els.ovAddress.textContent = 'Resolving address…';
    else els.ovAddress.textContent = state.address;
  }
  const extra = fmtExtra(null);
  els.ovExtra.textContent = extra;
  els.ovTime.textContent = fmtTime(new Date());
  const remark = els.remark.value.trim();
  els.ovRemark.textContent = remark ? '“' + remark + '”' : '';

  // Show/hide overlay lines per field toggles; map only on the 'card' template.
  els.ovAddress.classList.toggle('hidden', !f.address);
  els.ovCoords.classList.toggle('hidden', !f.coords);
  els.ovExtra.classList.toggle('hidden', !extra);
  els.ovTime.classList.toggle('hidden', !f.datetime);
  els.ovRemark.classList.toggle('hidden', !(f.remark && remark));
  if (els.ovMap) els.ovMap.classList.toggle('hidden', !(f.map && settings.template === 'card'));
}

setInterval(() => { els.ovTime.textContent = fmtTime(new Date()); }, 1000);
els.remark.addEventListener('input', renderOverlay);

/* ---------------- Capture / composite ---------------- */

// Re-geocode the exact current fix unless the cached address already describes
// it, so the photo never pairs fresh coordinates with a stale address.
async function ensureAddressForCurrentFix() {
  if (!state.geo) return;
  const { lat, lon } = state.geo;
  const f = state.addressFor;
  const fresh = f && Math.abs(f.lat - lat) < 1e-5 && Math.abs(f.lon - lon) < 1e-5;
  if (fresh && state.address) return;
  setStatus('stamping location…');
  try {
    // Cap the wait so capture stays responsive; fall back to whatever we have.
    await Promise.race([
      reverseGeocode(lat, lon),
      new Promise((_, rej) => setTimeout(() => rej(new Error('geocode timeout')), 4000)),
    ]);
    lastGeocodeAt = Date.now();
  } catch (err) {
    console.warn('capture geocode fell back to cached address', err);
  }
}

// state.capture holds an immutable snapshot of the shot: the raw (un-stamped)
// frame plus the geo/address/time/map captured at shutter time. The remark is
// the one mutable field — editable on the result screen before saving.
async function capturePhoto() {
  const v = els.video;
  if (!v.videoWidth) { setStatus('camera not ready'); return; }

  const W = v.videoWidth, H = v.videoHeight;
  // Freeze the raw frame at the instant of the shutter onto its own canvas, so
  // we can re-stamp it later when the remark changes without re-capturing.
  const raw = document.createElement('canvas');
  raw.width = W;
  raw.height = H;
  raw.getContext('2d').drawImage(v, 0, 0, W, H);

  // Ensure the stamped address matches the coordinates we're about to stamp.
  await ensureAddressForCurrentFix();

  const now = new Date();
  state.capture = {
    id: now.getTime(),
    raw,
    W, H,
    date: now,
    geo: state.geo ? { ...state.geo } : null,
    address: state.address,
    timeStr: fmtTime(now),
    remark: els.remark.value.trim(),
    project: settings.lastProject || '',
    tags: [],
    weather: state.weather ? { ...state.weather } : null,
    plusCode: state.plusCode,
    mapTile: state.mapTile,
    mapMarker: state.mapMarker,
    saved: false,
  };

  els.resultRemark.value = state.capture.remark;
  els.resultProject.value = state.capture.project;
  els.resultTags.value = '';
  await composeCapture();
  showResult();
}

// Re-stamp the frozen frame with the current capture metadata (incl. remark)
// and refresh the result preview. Returns the JPEG blob.
function composeCapture() {
  const c = state.capture;
  const canvas = els.captureCanvas;
  canvas.width = c.W;
  canvas.height = c.H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(c.raw, 0, 0);
  drawGeotagPanel(ctx, c.W, c.H, c);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) { setStatus('compose failed'); resolve(null); return; }
      if (state.lastBlobUrl) URL.revokeObjectURL(state.lastBlobUrl);
      state.lastBlobUrl = URL.createObjectURL(blob);
      state.lastBlob = blob;
      els.resultImg.src = state.lastBlobUrl;
      resolve(blob);
    }, 'image/jpeg', 0.92);
  });
}

// Build the list of text lines for the stamp, honoring field toggles.
function buildStampLines(meta, fontBase) {
  const f = settings.fields;
  const accent = settings.accent;
  const lines = [];
  if (f.coords && meta.geo) {
    lines.push({ t: fmtCoords(meta.geo.lat, meta.geo.lon), c: '#cbd5e1', s: fontBase });
  }
  const extra = meta.geo ? fmtExtra(meta) : '';
  if (extra) lines.push({ t: extra, c: '#94a3b8', s: Math.round(fontBase * 0.92) });
  if (f.datetime) lines.push({ t: meta.timeStr, c: '#94a3b8', s: fontBase });
  const remark = (meta.remark || '').trim();
  if (f.remark && remark) lines.push({ t: '“' + remark + '”', c: accent, s: fontBase, italic: true });
  return lines;
}

// Draw an uploaded logo as a watermark in the top-right corner.
function drawLogo(ctx, W, H) {
  if (!settings.showLogo || !logoImg) return;
  const maxW = W * 0.20, maxH = H * 0.10;
  const ratio = Math.min(maxW / logoImg.width, maxH / logoImg.height);
  const w = logoImg.width * ratio, h = logoImg.height * ratio;
  const x = W - w - Math.round(W * 0.02), y = Math.round(W * 0.02);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = Math.round(W * 0.005);
  ctx.drawImage(logoImg, x, y, w, h);
  ctx.restore();
}

// Draw the geotag stamp scaled to the photo, per the selected template.
function drawGeotagPanel(ctx, W, H, meta) {
  drawLogo(ctx, W, H);
  if (settings.template === 'minimal') return drawMinimal(ctx, W, H, meta);
  return drawBottomPanel(ctx, W, H, meta, settings.template === 'card');
}

// Full-width bottom panel; with an optional mini map (the 'card' template).
function drawBottomPanel(ctx, W, H, meta, withMap) {
  const f = settings.fields;
  const pad = Math.round(W * 0.02);
  const fontBase = Math.max(14, Math.round(W * 0.022));
  const lineGap = Math.round(fontBase * 1.35);
  const useMap = withMap && f.map && meta.mapTile;
  const mapSize = Math.round(W * 0.16);

  const lines = buildStampLines(meta, fontBase);
  const textX = useMap ? pad * 2 + mapSize : pad;
  const maxTextW = W - textX - pad * 2;

  ctx.font = `700 ${Math.round(fontBase * 1.15)}px sans-serif`;
  const addr = f.address ? (meta.address || (meta.geo ? 'Address unavailable' : 'No location')) : '';
  const addrLines = addr ? wrapText(ctx, addr, maxTextW).slice(0, 2) : [];

  const textBlockH = (addrLines.length + lines.length) * lineGap;
  const panelH = Math.max(useMap ? mapSize : 0, textBlockH) + pad * 2;
  const panelY = H - panelH;

  ctx.fillStyle = 'rgba(15,23,42,0.72)';
  ctx.fillRect(0, panelY, W, panelH);
  ctx.fillStyle = settings.accent;
  ctx.fillRect(0, panelY, Math.round(W * 0.008), panelH);

  if (useMap) {
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = mapSize * 2;
    renderMiniMap(tmp, mapSize, meta.mapTile, meta.mapMarker);
    roundedClipDraw(ctx, tmp, pad, panelY + pad, mapSize, mapSize, Math.round(mapSize * 0.08));
  }

  let y = panelY + pad + Math.round(fontBase * 1.15);
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${Math.round(fontBase * 1.15)}px sans-serif`;
  ctx.fillStyle = '#f1f5f9';
  for (const l of addrLines) { ctx.fillText(l, textX, y); y += lineGap; }
  for (const l of lines) {
    ctx.fillStyle = l.c;
    ctx.font = `${l.italic ? 'italic ' : ''}${l.s}px sans-serif`;
    ctx.fillText(l.t, textX, y);
    y += lineGap;
  }
}

// Compact translucent box at bottom-left (the 'minimal' template).
function drawMinimal(ctx, W, H, meta) {
  const f = settings.fields;
  const pad = Math.round(W * 0.018);
  const fontBase = Math.max(12, Math.round(W * 0.018));
  const lineGap = Math.round(fontBase * 1.3);

  const lines = [];
  if (f.address && meta.address) {
    ctx.font = `700 ${fontBase}px sans-serif`;
    const addrLine = wrapText(ctx, meta.address, W * 0.6)[0];
    if (addrLine) lines.push({ t: addrLine, c: '#f1f5f9', s: fontBase, bold: true });
  }
  buildStampLines(meta, fontBase).forEach((l) => lines.push(l));
  if (!lines.length) return;

  // measure box width
  let maxW = 0;
  for (const l of lines) {
    ctx.font = `${l.bold ? '700 ' : ''}${l.italic ? 'italic ' : ''}${l.s}px sans-serif`;
    maxW = Math.max(maxW, ctx.measureText(l.t).width);
  }
  const boxW = maxW + pad * 2;
  const boxH = lines.length * lineGap + pad;
  const x = pad, y = H - boxH - pad;

  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,0.66)';
  roundRect(ctx, x, y, boxW, boxH, Math.round(fontBase * 0.5));
  ctx.fill();
  ctx.fillStyle = settings.accent;
  ctx.fillRect(x, y, Math.round(W * 0.006), boxH);
  ctx.restore();

  let ty = y + pad + fontBase * 0.5;
  ctx.textBaseline = 'alphabetic';
  for (const l of lines) {
    ctx.fillStyle = l.c;
    ctx.font = `${l.bold ? '700 ' : ''}${l.italic ? 'italic ' : ''}${l.s}px sans-serif`;
    ctx.fillText(l.t, x + pad, ty + fontBase);
    ty += lineGap;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundedClipDraw(ctx, src, x, y, w, h, r) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(src, x, y, w, h);
  ctx.restore();
}

function wrapText(ctx, text, maxW) {
  const words = text.split(' ');
  const out = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) out.push(line);
  return out;
}

/* ---------------- Capture log (IndexedDB) ---------------- */

const DB_NAME = 'geotag-capture';
const STORE = 'captures';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbTx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const out = fn(store);
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

// Persist the current shot to the log (stores the stamped JPEG + metadata).
async function logCapture(blob) {
  const c = state.capture;
  if (!c || !blob) return;
  const g = c.geo || {};
  const record = {
    id: c.id,
    ts: c.id,
    lat: g.lat ?? null,
    lon: g.lon ?? null,
    accuracy: g.accuracy ?? null,
    altitude: typeof g.altitude === 'number' ? g.altitude : null,
    speed: typeof g.speed === 'number' ? g.speed : null,
    heading: typeof g.heading === 'number' ? g.heading : null,
    plusCode: c.plusCode || null,
    temp: c.weather ? c.weather.temp : null,
    weatherCode: c.weather ? c.weather.code : null,
    address: c.address || null,
    remark: (c.remark || '').trim(),
    project: (c.project || '').trim(),
    tags: Array.isArray(c.tags) ? c.tags : [],
    blob,
  };
  await dbTx('readwrite', (store) => store.put(record));
  c.saved = true;
}

// Compose the photo and embed real EXIF GPS metadata into the JPEG.
async function buildFinalBlob() {
  const blob = await composeCapture();
  if (!blob) return null;
  const c = state.capture;
  if (!c || !c.geo || !window.GeoExif) return blob;
  return GeoExif.embedExif(blob, {
    lat: c.geo.lat,
    lon: c.geo.lon,
    altitude: typeof c.geo.altitude === 'number' ? c.geo.altitude : undefined,
    speed: typeof c.geo.speed === 'number' ? c.geo.speed : undefined,
    heading: typeof c.geo.heading === 'number' ? c.geo.heading : undefined,
    date: c.date,
    software: 'GeoTag Photo',
  });
}

async function getAllCaptures() {
  return dbTx('readonly', (store) => {
    const req = store.getAll();
    return new Promise((res) => { req.onsuccess = () => res(req.result || []); });
  }).then((p) => p);
}

async function deleteCapture(id) {
  await dbTx('readwrite', (store) => store.delete(id));
}

/* ---------------- View switching ---------------- */

function showStage(stage) {
  [els.cameraView, els.resultView, els.historyView, els.settingsView, els.mapView]
    .forEach((s) => s.classList.toggle('hidden', s !== stage));
}

function showResult() {
  showStage(els.resultView);
  const canShare = isNative || !!(navigator.canShare && navigator.share);
  els.shareBtn.classList.toggle('hidden', !canShare);
  setStatus('captured · add a remark or save');
}

function showCamera() {
  showStage(els.cameraView);
  setStatus('camera ready');
}

async function showHistory() {
  showStage(els.historyView);
  setStatus('saved captures');
  await renderHistory();
}

function showSettings() {
  showStage(els.settingsView);
  setStatus('settings');
}

async function showMap() {
  showStage(els.mapView);
  setStatus('captures map');
  await renderCapturesMap();
}

/* ---------------- History gallery ---------------- */

let historyUrls = [];

async function renderHistory() {
  // revoke previous object URLs to avoid leaks
  historyUrls.forEach((u) => URL.revokeObjectURL(u));
  historyUrls = [];

  const all = (await getAllCaptures()).sort((a, b) => b.ts - a.ts);
  populateProjectControls(all);

  const filter = els.projectFilter.value;
  const items = filter ? all.filter((it) => (it.project || '') === filter) : all;

  els.historyGrid.innerHTML = '';
  els.historyEmpty.classList.toggle('hidden', items.length > 0);

  for (const item of items) {
    const url = URL.createObjectURL(item.blob);
    historyUrls.push(url);
    const card = document.createElement('div');
    card.className = 'hist-card';
    const when = new Date(item.ts).toLocaleString(undefined, {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const place = item.address ? item.address.split(',').slice(0, 2).join(',') : 'No location';
    const proj = item.project ? `<span class="hist-proj">${escapeHtml(item.project)}</span>` : '';
    const tags = (item.tags && item.tags.length)
      ? `<div class="hist-tags">${item.tags.map((t) => `<span class="hist-tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    card.innerHTML =
      `<img src="${url}" alt="capture" />` +
      `<div class="hist-meta"><span class="hist-place">${escapeHtml(place)}</span>` +
      `<span class="hist-when">${when}${item.remark ? ' · “' + escapeHtml(item.remark) + '”' : ''}</span>` +
      `${proj}${tags}</div>` +
      `<button class="hist-del" title="Delete">🗑</button>`;
    card.querySelector('img').addEventListener('click', () => openLightbox(item));
    card.querySelector('.hist-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteCapture(item.id);
      renderHistory();
    });
    els.historyGrid.appendChild(card);
  }
}

// Keep the project filter <select> and the capture-form <datalist> in sync
// with the distinct project names that exist in the log.
function populateProjectControls(items) {
  const projects = [...new Set(items.map((it) => it.project).filter(Boolean))].sort();
  const current = els.projectFilter.value;
  els.projectFilter.innerHTML = '<option value="">All projects</option>' +
    projects.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if (projects.includes(current)) els.projectFilter.value = current;
  els.projectList.innerHTML = projects.map((p) => `<option value="${escapeHtml(p)}"></option>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Captures map ---------------- */

let mapPins = [];   // [{ x, y, item }] in CSS pixels, for click hit-testing

// Web-Mercator projection: lat/lon -> global pixel coords at zoom z.
function mercator(lat, lon, z) {
  const ws = 256 * Math.pow(2, z);
  const x = ((lon + 180) / 360) * ws;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * ws;
  return { x, y };
}

async function renderCapturesMap() {
  const items = (await getAllCaptures()).filter((it) => it.lat != null && it.lon != null);
  els.mapEmpty.classList.toggle('hidden', items.length > 0);
  els.capturesMap.classList.toggle('hidden', items.length === 0);
  mapPins = [];
  if (!items.length) return;

  const canvas = els.capturesMap;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || (window.innerWidth - 32);
  const cssH = Math.round(Math.min(window.innerHeight * 0.62, 640));
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const lats = items.map((i) => i.lat), lons = items.map((i) => i.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);

  // Pick the largest zoom (<=16) at which all points fit with padding.
  let z = 16;
  for (; z > 1; z--) {
    const a = mercator(minLat, minLon, z), b = mercator(maxLat, maxLon, z);
    if (Math.abs(a.x - b.x) <= cssW * 0.8 && Math.abs(a.y - b.y) <= cssH * 0.8) break;
  }

  const center = mercator((minLat + maxLat) / 2, (minLon + maxLon) / 2, z);
  const originX = center.x - cssW / 2;
  const originY = center.y - cssH / 2;
  const n = Math.pow(2, z);

  // Fetch and draw the covering tiles.
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, cssW, cssH);
  const tx0 = Math.floor(originX / 256), tx1 = Math.floor((originX + cssW) / 256);
  const ty0 = Math.floor(originY / 256), ty1 = Math.floor((originY + cssH) / 256);
  const loads = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      const dx = tx * 256 - originX, dy = ty * 256 - originY;
      const sub = ['a', 'b', 'c'][Math.abs(tx + ty) % 3];
      loads.push(new Promise((res) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { ctx.drawImage(img, dx, dy, 256, 256); res(); };
        img.onerror = () => res();
        img.src = `https://${sub}.tile.openstreetmap.org/${z}/${wx}/${ty}.png`;
      }));
    }
  }
  await Promise.all(loads);

  // Draw a pin per capture and remember its position for click hit-testing.
  for (const it of items) {
    const g = mercator(it.lat, it.lon, z);
    const x = g.x - originX, y = g.y - originY;
    mapPins.push({ x, y, item: it });
    drawPin(ctx, x, y);
  }
}

// Fixed high-contrast pin so markers stay visible regardless of accent color.
function drawPin(ctx, x, y, color = '#ef4444') {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.restore();
}

let lightboxUrl = null;
function openLightbox(item) {
  if (lightboxUrl) URL.revokeObjectURL(lightboxUrl);
  lightboxUrl = URL.createObjectURL(item.blob);
  els.lightboxImg.src = lightboxUrl;
  els.lightbox.classList.remove('hidden');
  els.lbShare.classList.toggle('hidden', !isNative && !(navigator.canShare && navigator.share));
  els.lbShare.onclick = () => shareBlob(item.blob);
  els.lbDelete.onclick = async () => {
    await deleteCapture(item.id);
    closeLightbox();
    renderHistory();
    if (!els.mapView.classList.contains('hidden')) renderCapturesMap();
  };
}

function closeLightbox() {
  els.lightbox.classList.add('hidden');
  if (lightboxUrl) { URL.revokeObjectURL(lightboxUrl); lightboxUrl = null; }
}

/* ---------------- Save / share ---------------- */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function saveNative(blob, name) {
  const base64 = await blobToBase64(blob);
  await CapFS.writeFile({ path: name, data: base64, directory: 'DOCUMENTS' });
}

async function shareBlob(blob) {
  const file = new File([blob], 'geotag.jpg', { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'GeoTag Photo' });
    } else if (isNative) {
      // Write to cache then hand off to the OS share sheet via URL.
      const base64 = await blobToBase64(blob);
      const tmp = `geotag_share_${Date.now()}.jpg`;
      const { uri } = await CapFS.writeFile({ path: tmp, data: base64, directory: 'CACHE' });
      if (window.Capacitor.Plugins.Share) {
        await window.Capacitor.Plugins.Share.share({ title: 'GeoTag Photo', url: uri });
      }
    }
  } catch (err) { console.warn('share cancelled', err); }
}

/* ---------------- Wire up controls ---------------- */

els.shutter.addEventListener('click', capturePhoto);
els.retakeBtn.addEventListener('click', showCamera);
els.locBtn.addEventListener('click', () => { setStatus('refreshing location…'); startGeo(); });
els.historyBtn.addEventListener('click', showHistory);
els.historyBack.addEventListener('click', showCamera);
els.settingsBtn.addEventListener('click', showSettings);
els.settingsBack.addEventListener('click', showCamera);
els.mapBtn.addEventListener('click', showMap);
els.mapBack.addEventListener('click', showCamera);
els.projectFilter.addEventListener('change', renderHistory);
els.lbClose.addEventListener('click', closeLightbox);

// Tap a pin on the captures map to open that capture.
els.capturesMap.addEventListener('click', (e) => {
  const rect = els.capturesMap.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  let best = null, bestD = 18 * 18;
  for (const p of mapPins) {
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) openLightbox(best.item);
});

/* ---------------- Settings controls ---------------- */

els.templateOpts.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.template = btn.dataset.template;
  saveSettings();
  applySettings();
});

els.accentOpts.addEventListener('click', (e) => {
  const btn = e.target.closest('.swatch');
  if (!btn) return;
  settings.accent = btn.dataset.accent;
  saveSettings();
  applySettings();
});

document.querySelectorAll('#settingsView input[data-field]').forEach((cb) => {
  cb.addEventListener('change', () => {
    settings.fields[cb.dataset.field] = cb.checked;
    saveSettings();
    applySettings();
  });
});

els.logoToggle.addEventListener('change', () => {
  settings.showLogo = els.logoToggle.checked;
  saveSettings();
  applySettings();
});

els.logoInput.addEventListener('change', () => {
  const file = els.logoInput.files && els.logoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    settings.logo = reader.result;
    settings.showLogo = true;
    saveSettings();
    loadLogoImage();
    applySettings();
  };
  reader.readAsDataURL(file);
});

els.logoRemove.addEventListener('click', () => {
  settings.logo = null;
  settings.showLogo = false;
  logoImg = null;
  els.logoInput.value = '';
  saveSettings();
  applySettings();
});
els.flipBtn.addEventListener('click', () => {
  state.facing = state.facing === 'environment' ? 'user' : 'environment';
  startCamera();
});

// Edit the remark after capture: re-stamp the photo live as the user types.
let remarkDebounce;
els.resultRemark.addEventListener('input', () => {
  if (!state.capture) return;
  state.capture.remark = els.resultRemark.value;
  state.capture.saved = false; // edited since last save
  clearTimeout(remarkDebounce);
  remarkDebounce = setTimeout(composeCapture, 200);
});

// Project & tags are organizational metadata (logged, not stamped on the photo).
els.resultProject.addEventListener('input', () => {
  if (!state.capture) return;
  state.capture.project = els.resultProject.value.trim();
  settings.lastProject = state.capture.project; // default for the next shot
});
// Persist the remembered project once editing settles, not on every keystroke.
els.resultProject.addEventListener('change', saveSettings);

els.resultTags.addEventListener('input', () => {
  if (!state.capture) return;
  state.capture.tags = parseTags(els.resultTags.value);
});

function parseTags(str) {
  return str.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12);
}

els.saveBtn.addEventListener('click', async () => {
  if (!state.capture) return;
  setStatus('embedding GPS metadata…');
  const blob = await buildFinalBlob();
  await logCapture(blob);
  if (isNative) {
    try {
      await saveNative(blob, `geotag_${state.capture.id}.jpg`);
      setStatus('saved to Files ✓ (with EXIF GPS)');
    } catch (err) {
      console.error('native save failed', err);
      setStatus('save failed — try sharing instead');
    }
  } else {
    downloadBlob(blob, `geotag_${state.capture.id}.jpg`);
    setStatus('saved to log ✓ (with EXIF GPS)');
  }
});

els.shareBtn.addEventListener('click', async () => {
  if (!state.capture) return;
  const blob = await buildFinalBlob();
  await logCapture(blob); // sharing also records it in the log
  await shareBlob(blob);
});

els.exportCsv.addEventListener('click', exportCsv);
els.exportGeo.addEventListener('click', exportGeoJson);

/* ---------------- Export ---------------- */

function downloadText(text, name, type) {
  downloadBlob(new Blob([text], { type }), name);
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportCsv() {
  const items = (await getAllCaptures()).sort((a, b) => a.ts - b.ts);
  if (!items.length) { setStatus('nothing to export'); return; }
  const cols = ['id', 'datetime', 'lat', 'lon', 'accuracy_m', 'altitude_m',
    'speed_mps', 'heading_deg', 'plus_code', 'temp_c', 'weather_code', 'address',
    'remark', 'project', 'tags'];
  const rows = [cols.join(',')];
  for (const it of items) {
    rows.push([
      it.id, new Date(it.ts).toISOString(), it.lat, it.lon, it.accuracy,
      it.altitude, it.speed, it.heading, it.plusCode, it.temp, it.weatherCode,
      it.address, it.remark, it.project, (it.tags || []).join('; '),
    ].map(csvCell).join(','));
  }
  downloadText(rows.join('\n'), `geotag-log-${Date.now()}.csv`, 'text/csv');
  setStatus(`exported ${items.length} rows (CSV)`);
}

async function exportGeoJson() {
  const items = (await getAllCaptures()).sort((a, b) => a.ts - b.ts);
  if (!items.length) { setStatus('nothing to export'); return; }
  const fc = {
    type: 'FeatureCollection',
    features: items.filter((it) => it.lat != null).map((it) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [it.lon, it.lat] },
      properties: {
        id: it.id,
        datetime: new Date(it.ts).toISOString(),
        accuracy_m: it.accuracy,
        altitude_m: it.altitude,
        speed_mps: it.speed,
        heading_deg: it.heading,
        plus_code: it.plusCode,
        temp_c: it.temp,
        weather_code: it.weatherCode,
        address: it.address,
        remark: it.remark,
        project: it.project,
        tags: it.tags || [],
      },
    })),
  };
  downloadText(JSON.stringify(fc, null, 2), `geotag-log-${Date.now()}.geojson`, 'application/geo+json');
  setStatus(`exported ${fc.features.length} points (GeoJSON)`);
}

/* ---------------- Draggable overlay (PiP) ---------------- */

function initOverlayDrag() {
  const el = els.overlay;

  // Restore saved position.
  if (settings.overlayPos) {
    el.style.left   = settings.overlayPos.x + 'px';
    el.style.top    = settings.overlayPos.y + 'px';
    el.style.bottom = 'auto';
    el.style.right  = 'auto';
  }

  let startPtrX, startPtrY, startElX, startElY, dragging = false;

  function dragStart(clientX, clientY) {
    const elRect    = el.getBoundingClientRect();
    const stageRect = els.cameraView.getBoundingClientRect();
    startPtrX = clientX;
    startPtrY = clientY;
    startElX  = elRect.left - stageRect.left;
    startElY  = elRect.top  - stageRect.top;
    dragging  = true;
    el.classList.add('dragging');
  }

  function dragMove(clientX, clientY) {
    if (!dragging) return;
    const stageRect = els.cameraView.getBoundingClientRect();
    const elRect    = el.getBoundingClientRect();
    let x = startElX + (clientX - startPtrX);
    let y = startElY + (clientY - startPtrY);
    x = Math.max(8, Math.min(x, stageRect.width  - elRect.width  - 8));
    y = Math.max(8, Math.min(y, stageRect.height - elRect.height - 8));
    el.style.left   = x + 'px';
    el.style.top    = y + 'px';
    el.style.bottom = 'auto';
    el.style.right  = 'auto';
  }

  function dragEnd() {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    const elRect    = el.getBoundingClientRect();
    const stageRect = els.cameraView.getBoundingClientRect();
    settings.overlayPos = {
      x: elRect.left - stageRect.left,
      y: elRect.top  - stageRect.top,
    };
    saveSettings();
  }

  // Touch (iPhone / simulator touch injection)
  el.addEventListener('touchstart', (e) => {
    dragStart(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchmove', (e) => {
    dragMove(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchend', dragEnd);

  // Mouse (browser / macOS simulator)
  el.addEventListener('mousedown', (e) => {
    dragStart(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => dragMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', dragEnd);
}

/* ---------------- Boot ---------------- */

window.addEventListener('beforeunload', stopCamera);

(async function init() {
  loadLogoImage();
  applySettings();
  initOverlayDrag();
  getAllCaptures().then(populateProjectControls).catch(() => {});
  if (isNative) {
    // Request camera + location permissions upfront so iOS shows the prompts
    // before the user hits the shutter, not during capture.
    await CapGeo.requestPermissions().catch(() => {});
    if (window.Capacitor.Plugins.Camera) {
      await window.Capacitor.Plugins.Camera.requestPermissions().catch(() => {});
    }
  }
  await startCamera();
  startGeo();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
})();
