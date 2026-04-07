/**
 * server.js — Weather + Waves backend
 *
 * Serves the static frontend from /public and proxies
 * requests to the two Open-Meteo APIs (no API key needed).
 *
 * Fixes:
 * - Uses Node 18 built-in fetch() instead of https/http manual parsing
 * - Handles compressed upstream responses correctly
 * - Logs upstream status + response preview on failure
 * - Validates coordinates more safely
 */

const express = require('express');
const path = require('path');

// Generate the home-screen icon PNG before serving (works on Railway too)
require('./generate-icon');

const app = express();
const PORT = process.env.PORT || 3008;

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helper: fetch JSON safely using Node 18 fetch() ─────────────────────────
async function fetchJSON(url, label = 'Upstream') {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'weather-waves/1.0'
    }
  });

  const rawText = await response.text();

  if (!response.ok) {
    console.error(`[${label}] Upstream status:`, response.status);
    console.error(`[${label}] Upstream body preview:`, rawText.slice(0, 500));
    throw new Error(`Upstream responded with status ${response.status}`);
  }

  try {
    return JSON.parse(rawText);
  } catch (err) {
    console.error(`[${label}] Failed to parse JSON`);
    console.error(`[${label}] Upstream body preview:`, rawText.slice(0, 500));
    throw new Error('Failed to parse upstream response');
  }
}

// ─── Helper: parse coordinates safely ─────────────────────────────────────────
function parseCoordinate(value, fallback) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

// ─── Route: Weather API proxy ─────────────────────────────────────────────────
// Calls Open-Meteo forecast API for current temperature + weather code
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
    `&timezone=auto`;

  try {
    const data = await fetchJSON(url, 'Weather');
    res.json(data);
  } catch (err) {
    console.error('[Weather] Error:', err.message);
    res.status(502).json({
      error: 'Failed to fetch weather data',
      details: err.message
    });
  }
});

// ─── Route: Marine API proxy ──────────────────────────────────────────────────
// Calls Open-Meteo marine API for hourly wave height + sea surface temperature
app.get('/api/marine', async (req, res) => {
  const lat = parseCoordinate(req.query.lat, 32.08);
  const lon = parseCoordinate(req.query.lon, 34.78);

  const url =
    `https://marine-api.open-meteo.com/v1/marine` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&hourly=wave_height,wave_direction,sea_surface_temperature` +
    `&timezone=auto`;

  try {
    const data = await fetchJSON(url, 'Marine');
    res.json(data);
  } catch (err) {
    console.error('[Marine] Error:', err.message);
    res.status(502).json({
      error: 'Failed to fetch marine data',
      details: err.message
    });
  }
});

// ─── Optional: health check ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Weather + Waves running at http://localhost:${PORT}`);
});