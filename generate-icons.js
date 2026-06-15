// Generates icons/icon-192.png and icon-512.png with no external deps.
// Draws a dark rounded tile with a location pin. Run: node generate-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function px(buf, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w || y >= w) return;
  const i = (y * w + x) * 4;
  const ia = a / 255;
  buf[i]   = Math.round(r * ia + buf[i]   * (1 - ia));
  buf[i+1] = Math.round(g * ia + buf[i+1] * (1 - ia));
  buf[i+2] = Math.round(b * ia + buf[i+2] * (1 - ia));
  buf[i+3] = 255;
}

function makeIcon(size) {
  const w = size;
  const buf = Buffer.alloc(w * w * 4);
  const radius = size * 0.22;
  // rounded dark tile
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      // rounded-corner test
      const rx = Math.min(x, w - 1 - x), ry = Math.min(y, w - 1 - y);
      let inside = true;
      if (rx < radius && ry < radius) {
        const dx = radius - rx, dy = radius - ry;
        inside = dx * dx + dy * dy <= radius * radius;
      }
      if (inside) px(buf, w, x, y, 15, 23, 42, 255);
    }
  }
  // pin: head circle + tapered point
  const cx = size / 2, cy = size * 0.42, headR = size * 0.20;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      // circular head
      if (dx * dx + dy * dy <= headR * headR) px(buf, w, x, y, 56, 189, 248, 255);
      // triangular point below head
      if (y > cy) {
        const t = (y - cy) / (size * 0.32);
        const halfW = headR * (1 - t);
        if (t <= 1 && Math.abs(dx) <= halfW) px(buf, w, x, y, 56, 189, 248, 255);
      }
    }
  }
  // inner white dot
  const dotR = size * 0.075;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= dotR * dotR) px(buf, w, x, y, 255, 255, 255, 255);
    }
  }
  return encodePNG(buf, w, w);
}

function encodePNG(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  const chunks = [];
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', idat));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const crcTable = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const dir = path.join(__dirname, 'www', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), makeIcon(512));
console.log('Wrote icons/icon-192.png and icons/icon-512.png');
