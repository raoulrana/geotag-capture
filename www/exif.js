'use strict';
/* ----------------------------------------------------------------
   Minimal, spec-correct EXIF writer.
   Builds a little-endian TIFF block (IFD0 + Exif sub-IFD + GPS IFD),
   wraps it in an APP1 segment and splices it into a JPEG right after
   the SOI marker. No dependencies.

   Exposed as window.GeoExif.embedExif(blob, data) -> Promise<Blob>
   data: { lat, lon, altitude?, speed?, heading?, date? (JS Date) }
-----------------------------------------------------------------*/
(function () {
  const TYPE = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 };
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

  function asciiBytes(str) {
    // EXIF ASCII values are NUL-terminated.
    const s = str + '\0';
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function rationalBytes(pairs) {
    // pairs: array of [numerator, denominator]; little-endian LONGs.
    const out = new Uint8Array(pairs.length * 8);
    const dv = new DataView(out.buffer);
    pairs.forEach(([n, d], i) => {
      dv.setUint32(i * 8, n >>> 0, true);
      dv.setUint32(i * 8 + 4, d >>> 0, true);
    });
    return out;
  }

  function byteBytes(arr) { return new Uint8Array(arr); }

  // Decimal degrees -> [deg/1, min/1, sec*1000/1000] rationals.
  function toDMS(dec) {
    dec = Math.abs(dec);
    const d = Math.floor(dec);
    const m = Math.floor((dec - d) * 60);
    const s = (dec - d - m / 60) * 3600;
    return rationalBytes([[d, 1], [m, 1], [Math.round(s * 1000), 1000]]);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  // Build one IFD given entries; external (>4 byte) values go into `ext`.
  // entries: [{ tag, type, count, value: Uint8Array }] sorted by tag.
  // Returns the serialized IFD bytes (without external data). `baseOffset`
  // is this IFD's absolute offset in the TIFF block; `extOffset` is the
  // absolute offset where the shared external-data area begins; `nextIFD`
  // is the offset to write in the "next IFD" link (0 = none).
  function buildIFD(entries, baseOffset, ext, nextIFD) {
    const n = entries.length;
    const size = 2 + n * 12 + 4;
    const buf = new Uint8Array(size);
    const dv = new DataView(buf.buffer);
    dv.setUint16(0, n, true);
    entries.forEach((e, i) => {
      const off = 2 + i * 12;
      dv.setUint16(off, e.tag, true);
      dv.setUint16(off + 2, e.type, true);
      dv.setUint32(off + 4, e.count, true);
      const byteLen = e.count * TYPE_SIZE[e.type];
      if (byteLen <= 4) {
        buf.set(e.value.subarray(0, byteLen), off + 8); // inline, left-justified
      } else {
        dv.setUint32(off + 8, ext.offset, true); // pointer into external area
        ext.chunks.push(e.value);
        ext.offset += byteLen + (byteLen % 2); // word-align
      }
    });
    dv.setUint32(2 + n * 12, nextIFD, true);
    return buf;
  }

  function buildExif(data) {
    const date = data.date instanceof Date ? data.date : new Date();
    const local =
      `${date.getFullYear()}:${pad2(date.getMonth() + 1)}:${pad2(date.getDate())} ` +
      `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

    // --- GPS IFD entries (sorted by tag) ---
    const gps = [];
    gps.push({ tag: 0x0000, type: TYPE.BYTE, count: 4, value: byteBytes([2, 3, 0, 0]) });
    gps.push({ tag: 0x0001, type: TYPE.ASCII, count: 2, value: asciiBytes(data.lat >= 0 ? 'N' : 'S') });
    gps.push({ tag: 0x0002, type: TYPE.RATIONAL, count: 3, value: toDMS(data.lat) });
    gps.push({ tag: 0x0003, type: TYPE.ASCII, count: 2, value: asciiBytes(data.lon >= 0 ? 'E' : 'W') });
    gps.push({ tag: 0x0004, type: TYPE.RATIONAL, count: 3, value: toDMS(data.lon) });
    if (typeof data.altitude === 'number' && isFinite(data.altitude)) {
      gps.push({ tag: 0x0005, type: TYPE.BYTE, count: 1, value: byteBytes([data.altitude < 0 ? 1 : 0]) });
      gps.push({ tag: 0x0006, type: TYPE.RATIONAL, count: 1, value: rationalBytes([[Math.round(Math.abs(data.altitude) * 100), 100]]) });
    }
    if (typeof data.speed === 'number' && isFinite(data.speed)) {
      gps.push({ tag: 0x000C, type: TYPE.ASCII, count: 2, value: asciiBytes('K') }); // km/h
      gps.push({ tag: 0x000D, type: TYPE.RATIONAL, count: 1, value: rationalBytes([[Math.round(data.speed * 3.6 * 100), 100]]) });
    }
    if (typeof data.heading === 'number' && isFinite(data.heading)) {
      gps.push({ tag: 0x0010, type: TYPE.ASCII, count: 2, value: asciiBytes('T') }); // true north
      gps.push({ tag: 0x0011, type: TYPE.RATIONAL, count: 1, value: rationalBytes([[Math.round(data.heading * 100), 100]]) });
    }
    // UTC time + date stamps
    gps.push({
      tag: 0x0007, type: TYPE.RATIONAL, count: 3,
      value: rationalBytes([[date.getUTCHours(), 1], [date.getUTCMinutes(), 1], [date.getUTCSeconds(), 1]]),
    });
    gps.push({ tag: 0x0012, type: TYPE.ASCII, count: 7, value: asciiBytes('WGS-84') });
    const ds = `${date.getUTCFullYear()}:${pad2(date.getUTCMonth() + 1)}:${pad2(date.getUTCDate())}`;
    gps.push({ tag: 0x001D, type: TYPE.ASCII, count: ds.length + 1, value: asciiBytes(ds) });
    gps.sort((a, b) => a.tag - b.tag);

    // --- Exif sub-IFD ---
    const exif = [
      { tag: 0x9003, type: TYPE.ASCII, count: 20, value: asciiBytes(local) }, // DateTimeOriginal
      { tag: 0x9004, type: TYPE.ASCII, count: 20, value: asciiBytes(local) }, // DateTimeDigitized
    ];

    // --- IFD0 (with pointers filled in after we know sizes) ---
    const ifd0 = [
      { tag: 0x0132, type: TYPE.ASCII, count: 20, value: asciiBytes(local) }, // DateTime
      { tag: 0x8769, type: TYPE.LONG, count: 1, value: rationalBytes([[0, 1]]).subarray(0, 4) }, // ExifIFD ptr (placeholder)
      { tag: 0x8825, type: TYPE.LONG, count: 1, value: rationalBytes([[0, 1]]).subarray(0, 4) }, // GPSIFD ptr (placeholder)
    ];
    if (data.software) {
      ifd0.unshift({ tag: 0x0131, type: TYPE.ASCII, count: data.software.length + 1, value: asciiBytes(data.software) });
    }
    ifd0.sort((a, b) => a.tag - b.tag);

    // Compute layout offsets (TIFF header = 8 bytes).
    const sizeIFD0 = 2 + ifd0.length * 12 + 4;
    const sizeExif = 2 + exif.length * 12 + 4;
    const sizeGPS = 2 + gps.length * 12 + 4;
    const offIFD0 = 8;
    const offExif = offIFD0 + sizeIFD0;
    const offGPS = offExif + sizeExif;
    const offData = offGPS + sizeGPS;

    // Patch the IFD0 pointer entries now that offsets are known.
    for (const e of ifd0) {
      if (e.tag === 0x8769) new DataView(e.value.buffer, e.value.byteOffset, 4).setUint32(0, offExif, true);
      if (e.tag === 0x8825) new DataView(e.value.buffer, e.value.byteOffset, 4).setUint32(0, offGPS, true);
    }

    // Serialize, collecting external data with absolute offsets.
    const ext = { offset: offData, chunks: [] };
    const b0 = buildIFD(ifd0, offIFD0, ext, 0);
    const bE = buildIFD(exif, offExif, ext, 0);
    const bG = buildIFD(gps, offGPS, ext, 0);

    // Assemble TIFF block: header + IFDs + external data.
    const extTotal = ext.offset - offData;
    const tiff = new Uint8Array(offData + extTotal);
    const tdv = new DataView(tiff.buffer);
    tiff[0] = 0x49; tiff[1] = 0x49;          // "II" little-endian
    tdv.setUint16(2, 0x002a, true);          // magic 42
    tdv.setUint32(4, offIFD0, true);         // offset to IFD0
    tiff.set(b0, offIFD0);
    tiff.set(bE, offExif);
    tiff.set(bG, offGPS);
    let cursor = offData;
    for (const c of ext.chunks) {
      tiff.set(c, cursor);
      cursor += c.length + (c.length % 2);   // re-apply word alignment padding
    }

    // Wrap in APP1: "Exif\0\0" + TIFF.
    const header = asciiBytes('Exif').subarray(0, 4); // "Exif" without our NUL
    const payload = new Uint8Array(6 + tiff.length);
    payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
    payload.set(tiff, 6);

    const segLen = payload.length + 2; // length field includes itself
    const app1 = new Uint8Array(2 + 2 + payload.length);
    app1[0] = 0xff; app1[1] = 0xe1;        // APP1 marker
    app1[2] = (segLen >> 8) & 0xff;        // big-endian length
    app1[3] = segLen & 0xff;
    app1.set(payload, 4);
    return app1;
  }

  // Splice the APP1 segment into a JPEG right after the SOI (FFD8).
  function insertApp1(jpeg, app1) {
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
    const out = new Uint8Array(jpeg.length + app1.length);
    out.set(jpeg.subarray(0, 2), 0);            // SOI
    out.set(app1, 2);                            // our EXIF APP1
    out.set(jpeg.subarray(2), 2 + app1.length);  // rest of the file
    return out;
  }

  async function embedExif(blob, data) {
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const app1 = buildExif(data);
      const out = insertApp1(buf, app1);
      return new Blob([out], { type: 'image/jpeg' });
    } catch (err) {
      console.warn('EXIF embed failed, returning original', err);
      return blob;
    }
  }

  const api = { embedExif, buildExif };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GeoExif = api;
})();
