/**
 * server.js — Weather + Waves backend
 *
 * Serves the static frontend from /public and proxies
 * requests to the two Open-Meteo APIs (no API key needed).
 */

const express = require('express');
const https   = require('https');
const http    = require('http');
const path    = require('path');

// Generate the home-screen icon PNG before serving (works on Railway too)
require('./generate-icon');

const app  = express();
const PORT = process.env.PORT || 3008;

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helper: fetch JSON from any URL (http or https) ─────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let raw = '';
      res.on('data',  chunk => { raw += chunk; });
      res.on('end',   ()    => {
        try   { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Failed to parse upstream response')); }
      });
    }).on('error', reject);
  });
}

// ─── Route: Weather API proxy ─────────────────────────────────────────────────
// Calls Open-Meteo forecast API for current temperature + weather code
app.get('/api/weather', async (req, res) => {
  const lat = parseFloat(req.query.lat) || 32.08;
  const lon = parseFloat(req.query.lon) || 34.78;
  const url = `https://api.open-meteo.com/v1/forecast` +
              `?latitude=${lat}&longitude=${lon}` +
              `&current=temperature_2m,weathercode` +
              `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
              `&timezone=auto`;
  try {
    const data = await fetchJSON(url);
    res.json(data);
  } catch (err) {
    console.error('[Weather] Error:', err.message);
    res.status(502).json({ error: 'Failed to fetch weather data' });
  }
});

// ─── Route: Marine API proxy ──────────────────────────────────────────────────
// Calls Open-Meteo marine API for hourly wave height + sea surface temperature
app.get('/api/marine', async (req, res) => {
  const lat = parseFloat(req.query.lat) || 32.08;
  const lon = parseFloat(req.query.lon) || 34.78;
  const url = `https://marine-api.open-meteo.com/v1/marine` +
              `?latitude=${lat}&longitude=${lon}` +
              `&hourly=wave_height,sea_surface_temperature`;
  try {
    const data = await fetchJSON(url);
    res.json(data);
  } catch (err) {
    console.error('[Marine] Error:', err.message);
    res.status(502).json({ error: 'Failed to fetch marine data' });
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Weather + Waves running at http://localhost:${PORT}`);
});
