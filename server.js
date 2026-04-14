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
const multer = require('multer');
const Jimp = require('jimp');
const archiver = require('archiver');

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
    execSync('git add skin-schedule.json', { cwd: __dirname, stdio: 'pipe' });
    try {
      execSync('git commit -m "Update skin schedule via admin"', { cwd: __dirname, stdio: 'pipe' });
    } catch (_) { /* nothing to commit — that's fine, still push */ }
    execSync('git push origin dev', { cwd: __dirname, stdio: 'pipe' });
    res.json({ ok: true, pushed: true });
  } catch (err) {
    res.json({ ok: true, pushed: false, gitError: err.message });
  }
});

app.post('/api/deploy-to-main', express.json(), (req, res) => {
  const WORKTREE = path.join(__dirname, '.main-deploy-worktree');
  try {
    // Find the currently active skin + its schedule entry
    const schedule = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'));
    const mmdd     = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(5);
    const active   = schedule.find(s => s.name !== 'default' && mmdd >= s.start && mmdd <= s.end);
    if (!active) return res.status(400).json({ error: 'No skin is currently active on dev.' });

    const skinName = active.name;
    const skinSrc  = path.join(SKINS_DIR, skinName);
    if (!fs.existsSync(skinSrc)) return res.status(400).json({ error: `Skin folder not found: ${skinName}` });

    // Clean up any leftover worktree
    if (fs.existsSync(WORKTREE)) {
      execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' });
    }

    // Create isolated worktree on main
    execSync(`git fetch origin main`, { cwd: __dirname, stdio: 'pipe' });
    execSync(`git worktree add "${WORKTREE}" origin/main`, { cwd: __dirname, stdio: 'pipe' });

    // Copy skin infrastructure files (server, frontend, default skin)
    const filesToSync = [
      'server.js',
      'package.json',
      'package-lock.json',
      path.join('public', 'index.html'),
      path.join('public', 'style.css'),
      path.join('public', 'script.js'),
    ];
    for (const f of filesToSync) {
      const src = path.join(__dirname, f);
      const dst = path.join(WORKTREE, f);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }

    // Copy default skin folder
    const defaultSrc = path.join(SKINS_DIR, 'default');
    const defaultDst = path.join(WORKTREE, 'public', 'skins', 'default');
    if (fs.existsSync(defaultSrc)) {
      fs.mkdirSync(defaultDst, { recursive: true });
      execSync(`xcopy /E /I /Y "${defaultSrc}" "${defaultDst}"`, { stdio: 'pipe' });
    }

    // Copy active skin folder into worktree
    const skinDest = path.join(WORKTREE, 'public', 'skins', skinName);
    fs.mkdirSync(skinDest, { recursive: true });
    execSync(`xcopy /E /I /Y "${skinSrc}" "${skinDest}"`, { stdio: 'pipe' });

    // Write skin-schedule.json on main with only this skin's entry
    const mainSchedulePath = path.join(WORKTREE, 'skin-schedule.json');
    let mainSchedule = [];
    if (fs.existsSync(mainSchedulePath)) {
      try { mainSchedule = JSON.parse(fs.readFileSync(mainSchedulePath, 'utf8')); } catch (_) {}
    }
    // Upsert this skin's entry, keep others
    const idx = mainSchedule.findIndex(s => s.name === skinName);
    if (idx >= 0) mainSchedule[idx] = active; else mainSchedule.push(active);
    fs.writeFileSync(mainSchedulePath, JSON.stringify(mainSchedule, null, 2));

    // Commit and push from the worktree
    execSync(`git add -A`, { cwd: WORKTREE, stdio: 'pipe' });
    try {
      execSync(`git commit -m "Deploy skin: ${skinName} (${active.start} → ${active.end})"`, { cwd: WORKTREE, stdio: 'pipe' });
    } catch (_) { /* nothing new to commit — still push */ }
    execSync(`git push origin HEAD:main`, { cwd: WORKTREE, stdio: 'pipe' });

    // Clean up
    execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' });

    res.json({ ok: true, skin: skinName });
  } catch (err) {
    try { execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' }); } catch (_) {}
    console.error('[deploy-to-main]', err.stderr?.toString() || err.message);
    res.status(500).json({ error: err.stderr?.toString() || err.message });
  }
});

app.post('/api/revert-main-to-default', (req, res) => {
  const WORKTREE = path.join(__dirname, '.main-deploy-worktree');
  try {
    if (fs.existsSync(WORKTREE)) {
      execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' });
    }
    execSync(`git fetch origin main`, { cwd: __dirname, stdio: 'pipe' });
    execSync(`git worktree add "${WORKTREE}" origin/main`, { cwd: __dirname, stdio: 'pipe' });

    // Sync infrastructure files so the skin system is present on main
    const filesToSync = [
      'server.js',
      'package.json',
      'package-lock.json',
      path.join('public', 'index.html'),
      path.join('public', 'style.css'),
      path.join('public', 'script.js'),
    ];
    for (const f of filesToSync) {
      const src = path.join(__dirname, f);
      const dst = path.join(WORKTREE, f);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }

    // Write an empty schedule so no skin is active → default ocean shows
    const mainSchedulePath = path.join(WORKTREE, 'skin-schedule.json');
    fs.writeFileSync(mainSchedulePath, '[]');

    execSync(`git add -A`, { cwd: WORKTREE, stdio: 'pipe' });
    try {
      execSync(`git commit -m "Revert main to default ocean skin"`, { cwd: WORKTREE, stdio: 'pipe' });
    } catch (_) { /* nothing to commit — still push */ }
    execSync(`git push origin HEAD:main`, { cwd: WORKTREE, stdio: 'pipe' });

    execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' });
    res.json({ ok: true });
  } catch (err) {
    try { execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' }); } catch (_) {}
    console.error('[revert-main]', err.stderr?.toString() || err.message);
    res.status(500).json({ error: err.stderr?.toString() || err.message });
  }
});

// ─── Skin Upload / Slicer ─────────────────────────────────────────────────────
const SKIN_SLICES = [
  { file: 'header-bg.png',       left: 0,   top: 0,    width: 1024, height: 370 },
  { file: 'drum-bg.png',         left: 0,   top: 370,  width: 1024, height: 120 },
  { file: 'weather-card-bg.png', left: 340, top: 580,  width: 345,  height: 185 },
  { file: 'wave-row-bg.png',     left: 0,   top: 770,  width: 1024, height: 210 },
  { file: 'wind-row-bg.png',     left: 0,   top: 980,  width: 1024, height: 105 },
  { file: 'bunting-bg.png',      left: 0,   top: 1085, width: 1024, height: 50  },
  { file: 'sunset-bg.png',       left: 0,   top: 1135, width: 512,  height: 155 },
  { file: 'sunrise-bg.png',      left: 512, top: 1135, width: 512,  height: 155 },
];

function skinCSS(name) {
  return `/* ${name} skin — auto-generated */
:root {
  --primary: #5C3A1E;
  --accent: #8B6914;
  --card-bg: #F5EDD0;
  --shadow: 0 4px 16px rgba(92,58,0,0.18);
  --radius: 12px;
  --text-dark: #3D2400;
  --text-mid: #7A5C30;
}
body { background: linear-gradient(160deg, #FBF3DC 0%, #F5E6C0 55%, #EDD5A0 100%); }
header { background: url('/skins/${name}/skin/header-bg.png') center center / cover no-repeat; }
.drum-wrapper { background: url('/skins/${name}/skin/drum-bg.png') center top / cover no-repeat; }
.wx-cell { background: url('/skins/${name}/skin/weather-card-bg.png') center center / cover no-repeat; }
.wv-cell { background: url('/skins/${name}/skin/wave-row-bg.png') center center / 300% 100% no-repeat; }
#waveRow .mx-cell:nth-child(1) { background-position: right center; }
#waveRow .mx-cell:nth-child(2) { background-position: center center; }
#waveRow .mx-cell:nth-child(3) { background-position: left center; }
.wd-cell { background: url('/skins/${name}/skin/wind-row-bg.png') center center / 300% 100% no-repeat; }
.drum-item { color: rgba(0,56,168,0.55); }
.drum-item.active { color: #002FA7; }
.drum-ring { border: 2px solid rgba(0,56,168,0.65); }
.sunrise-tile { background: url('/skins/${name}/skin/sunrise-bg.png') center center / cover no-repeat; }
.sunset-tile { background: url('/skins/${name}/skin/sunset-bg.png') center center / cover no-repeat; }
.sun-row { position: relative; margin-top: 10px; }
.sun-row::before {
  content: '';
  position: absolute;
  top: -22px; left: 0; right: 0;
  height: 22px;
  z-index: 5;
  background: url('/skins/${name}/skin/bunting-bg.png') center / cover no-repeat;
}
`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') cb(null, true);
    else cb(new Error('Only PNG files are accepted'));
  }
});

app.post('/api/upload-skin', upload.single('png'), async (req, res) => {
  try {
    const skinName = (req.body.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!skinName) return res.status(400).json({ error: 'Skin name is required' });
    if (!req.file)  return res.status(400).json({ error: 'PNG file is required' });

    // Validate dimensions
    const src = await Jimp.read(req.file.buffer);
    if (src.bitmap.width !== 1024 || src.bitmap.height !== 1536) {
      return res.status(400).json({
        error: `Image must be exactly 1024×1536 px. Got ${src.bitmap.width}×${src.bitmap.height}.`
      });
    }

    // Create skin dirs
    const skinDir = path.join(SKINS_DIR, skinName);
    const assetDir = path.join(skinDir, 'skin');
    fs.mkdirSync(assetDir, { recursive: true });

    // Slice and save
    await Promise.all(SKIN_SLICES.map(s => {
      const crop = src.clone().crop(s.left, s.top, s.width, s.height);
      return crop.writeAsync(path.join(assetDir, s.file));
    }));

    // Write style.css
    fs.writeFileSync(path.join(skinDir, 'style.css'), skinCSS(skinName));

    // Git push
    let pushed = false;
    let gitError = null;
    try {
      execSync(`git add public/skins/${skinName}`, { cwd: __dirname, stdio: 'pipe' });
      execSync(`git commit -m "Add skin: ${skinName}"`, { cwd: __dirname, stdio: 'pipe' });
      execSync('git push origin dev', { cwd: __dirname, stdio: 'pipe' });
      pushed = true;
    } catch (e) {
      gitError = e.stderr?.toString() || e.message;
    }

    res.json({ ok: true, name: skinName, pushed, gitError });
  } catch (err) {
    console.error('[upload-skin]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/download-skin/:name', (req, res) => {
  const skinName = req.params.name.replace(/[^a-z0-9-]/g, '');
  const skinDir  = path.join(SKINS_DIR, skinName);
  const assetDir = path.join(skinDir, 'skin');
  if (!fs.existsSync(assetDir)) return res.status(404).json({ error: 'Skin not found' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${skinName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { if (!res.headersSent) res.status(500).end(); });
  archive.pipe(res);
  archive.directory(assetDir, 'skin');
  archive.file(path.join(skinDir, 'style.css'), { name: 'style.css' });
  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`Weather + Waves running at http://localhost:${PORT}`);
});