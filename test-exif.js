// Verifies the EXIF writer produces metadata a real parser reads back correctly.
const exifr = require('exifr');
const { buildExif } = require('./www/exif.js');

(async () => {
  const date = new Date('2026-06-15T17:47:30Z');
  const data = { lat: 28.51707, lon: 77.19913, altitude: 216.5, speed: 0, heading: 90, date,
                 software: 'GeoTag Capture' };
  const app1 = buildExif(data);

  // Minimal JPEG: SOI + our APP1 + a tiny scan + EOI.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from(app1),
    Buffer.from([0xff, 0xd9]),
  ]);

  const parsed = await exifr.parse(jpeg, { gps: true, tiff: true, exif: true });
  const gps = await exifr.gps(jpeg);

  const round = (n) => Math.round(n * 1e5) / 1e5;
  const checks = [
    ['GPS latitude', round(gps.latitude), data.lat, Math.abs(gps.latitude - data.lat) < 1e-4],
    ['GPS longitude', round(gps.longitude), data.lon, Math.abs(gps.longitude - data.lon) < 1e-4],
    ['GPSAltitude', parsed.GPSAltitude, data.altitude, Math.abs(parsed.GPSAltitude - data.altitude) < 0.1],
    ['GPSImgDirection', parsed.GPSImgDirection, data.heading, Math.abs(parsed.GPSImgDirection - data.heading) < 0.1],
    ['DateTimeOriginal', parsed.DateTimeOriginal, 'a Date', parsed.DateTimeOriginal instanceof Date],
    ['GPSDateStamp', parsed.GPSDateStamp, '2026:06:15', String(parsed.GPSDateStamp).startsWith('2026:06:15')],
    ['Software', parsed.Software, 'GeoTag Capture', parsed.Software === 'GeoTag Capture'],
  ];

  let ok = true;
  for (const [name, got, want, pass] of checks) {
    console.log(`${pass ? '✓' : '✗'} ${name}: got ${got} (want ~${want})`);
    if (!pass) ok = false;
  }
  console.log(ok ? '\nALL EXIF CHECKS PASSED' : '\nEXIF CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})();
