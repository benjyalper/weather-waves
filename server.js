/**
 * server.js — Weather + Waves backend
 */

const express = require('express');
const path = require('path');

require('./generate-icon');

const app = express();
const PORT = process.env.PORT || 3008;

app.use(express.static(path.join(__dirname, 'public')));

function parseCoordinate(value, fallback) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

async function fetchJSON(url, label = 'Upstream', timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log(`[${label}] Requesting: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'weather-waves/1.0',
      },
      signal: controller.signal,
    });

    const rawText = await response.text();

    console.log(`[${label}] Status: ${response.status}`);
    console.log(`[${label}] Body preview: ${rawText.slice(0, 300)}`);

    if (!response.ok) {
      throw new Error(`Upstream responded with status ${response.status}`);
    }

    try {
      return JSON.parse(rawText);
    } catch {
      throw new Error('Failed to parse upstream response');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Upstream timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
    `&timezone=auto`;

  try {
    const data = await fetchJSON(url, 'Weather', 10000);
    res.json(data);
  } catch (err) {
    console.error('[Weather] Error:', err.message);
    res.status(502).json({
      error: 'Failed to fetch weather data',
      details: err.message,
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
    `&timezone=auto`;

  try {
    const data = await fetchJSON(url, 'Marine', 10000);
    res.json(data);
  } catch (err) {
    console.error('[Marine] Error:', err.message);
    res.status(502).json({
      error: 'Failed to fetch marine data',
      details: err.message,
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Weather + Waves running at http://localhost:${PORT}`);
});