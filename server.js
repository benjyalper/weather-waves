/**
 * server.js — Weather + Waves backend
 *
 * Serves the static frontend from /public and proxies
 * requests to the Open-Meteo weather and marine APIs.
 */

const express = require('express');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const { execSync } = require('child_process');

require('./generate-icon');

const app = express();
const PORT = process.env.PORT || 3008;

app.use(express.static(path.join(__dirname, 'public')));

// ─── Active skin ──────────────────────────────────────────────────────────────
app.get('/api/active-skin', (req, res) => {
  const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, 'skin-schedule.json'), 'utf8'));
  const mmdd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(5); // MM-DD (sv-SE always gives YYYY-MM-DD)
  const active = schedule.find(s => s.name !== 'default' && mmdd >= s.start && mmdd <= s.end);
  res.json({ skin: active?.name ?? 'default' });
});

function parseCoordinate(value, fallback) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function decodeBody(buffer, encoding = '') {
  const enc = String(encoding).toLowerCase();

  if (enc.includes('gzip')) {
    return zlib.gunzipSync(buffer).toString('utf8');
  }
  if (enc.includes('deflate')) {
    return zlib.inflateSync(buffer).toString('utf8');
  }
  if (enc.includes('br')) {
    return zlib.brotliDecompressSync(buffer).toString('utf8');
  }

  return buffer.toString('utf8');
}

function fetchJSON(url, label = 'Upstream', timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    console.log(`[${label}] Requesting: ${url}`);

    const req = https.request(
      url,
      {
        method: 'GET',
        family: 4,
        timeout: timeoutMs,
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate, br',
          'User-Agent': 'weather-waves/1.0'
        }
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));

        res.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            const rawText = decodeBody(buffer, res.headers['content-encoding']);

            console.log(`[${label}] Status: ${res.statusCode}`);
            console.log(`[${label}] Body preview: ${rawText.slice(0, 300)}`);

            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              return reject(
                new Error(`Upstream responded with status ${res.statusCode}`)
              );
            }

            const json = JSON.parse(rawText);
            resolve(json);
          } catch (err) {
            reject(new Error(`Failed to parse upstream response: ${err.message}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Upstream timeout after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

app.get('/api/weather', async (req, res) => {
  const lat = parseCoordinate(req.query.lat, 32.08);
  const lon = parseCoordinate(req.query.lon, 34.78);

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&current=temperature_2m,weather_code` +
    `&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&timezone=Asia%2FJerusalem`;

  try {
    const data = await fetchJSON(url, 'Weather', 10000);
    res.json(data);
  } catch (err) {
    console.error('[Weather] Error:', err.message);
    res.status(502).json({
      error: 'Failed to fetch weather data',
      details: err.message
    });
  }
});

app.get('/api/marine', async (req, res) => {
  const lat = parseCoordinate(req.query.lat, 32.08);
  const lon = parseCoordinate(req.query.lon, 34.78);

  const url =
    `https://marine-api.open-meteo.com/v1/marine` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&hourly=wave_height,wave_direction,sea_surface_temperature` +
    `&timezone=Asia%2FJerusalem`;

  try {
    const data = await fetchJSON(url, 'Marine', 10000);
    res.json(data);
  } catch (err) {
    console.error('[Marine] Error:', err.message);
    res.status(502).json({
      error: 'Failed to fetch marine data',
      details: err.message
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ─── Admin API ────────────────────────────────────────────────────────────────
const SCHEDULE_PATH = path.join(__dirname, 'skin-schedule.json');
const SKINS_DIR     = path.join(__dirname, 'public', 'skins');

app.get('/api/skins', (req, res) => {
  const dirs = fs.readdirSync(SKINS_DIR).filter(d =>
    fs.statSync(path.join(SKINS_DIR, d)).isDirectory()
  );
  res.json(dirs);
});

app.get('/api/schedule', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8')));
});

app.post('/api/schedule', express.json(), (req, res) => {
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(req.body, null, 2));
  try {
    execSync('git add skin-schedule.json && git commit -m "Update skin schedule via admin" && git push origin dev', {
      cwd: __dirname,
      stdio: 'pipe'
    });
    res.json({ ok: true, pushed: true });
  } catch (err) {
    // Save succeeded even if git push failed
    res.json({ ok: true, pushed: false, gitError: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Weather + Waves running at http://localhost:${PORT}`);
});