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

// ─── GitHub API helpers (used when GITHUB_TOKEN env var is set) ───────────────
// Without GITHUB_TOKEN the server falls back to local git CLI — no behaviour change.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'benjyalper/weather-waves';

async function ghRequest(method, endpoint, body) {
  const r = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization:          `Bearer ${GITHUB_TOKEN}`,
      'Content-Type':         'application/json',
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message || `GitHub API ${r.status}`);
  return json;
}

// Atomically commit multiple files to a branch via the Git Data API
async function ghCommitFiles(files, message, branch) {
  // files: [{ path: string (repo-relative, forward slashes), content: Buffer|string }]
  const ref    = await ghRequest('GET',  `/repos/${GITHUB_REPO}/git/ref/heads/${branch}`);
  const commit = await ghRequest('GET',  `/repos/${GITHUB_REPO}/git/commits/${ref.object.sha}`);

  const treeItems = await Promise.all(files.map(async f => {
    const buf  = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
    const blob = await ghRequest('POST', `/repos/${GITHUB_REPO}/git/blobs`, {
      content: buf.toString('base64'), encoding: 'base64'
    });
    return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
  }));

  const tree      = await ghRequest('POST',  `/repos/${GITHUB_REPO}/git/trees`,   { base_tree: commit.tree.sha, tree: treeItems });
  const newCommit = await ghRequest('POST',  `/repos/${GITHUB_REPO}/git/commits`, { message, tree: tree.sha, parents: [ref.object.sha] });
  await              ghRequest('PATCH', `/repos/${GITHUB_REPO}/git/refs/heads/${branch}`, { sha: newCommit.sha });
  return newCommit;
}

// Atomically delete multiple files from a branch via the Git Data API.
// Uses sha:null in tree items to mark deletions.
async function ghDeleteFiles(filePaths, message, branch) {
  const ref    = await ghRequest('GET', `/repos/${GITHUB_REPO}/git/ref/heads/${branch}`);
  const commit = await ghRequest('GET', `/repos/${GITHUB_REPO}/git/commits/${ref.object.sha}`);

  const treeItems = filePaths.map(p => ({
    path: p, mode: '100644', type: 'blob', sha: null
  }));

  const tree      = await ghRequest('POST',  `/repos/${GITHUB_REPO}/git/trees`,   { base_tree: commit.tree.sha, tree: treeItems });
  const newCommit = await ghRequest('POST',  `/repos/${GITHUB_REPO}/git/commits`, { message, tree: tree.sha, parents: [ref.object.sha] });
  await              ghRequest('PATCH', `/repos/${GITHUB_REPO}/git/refs/heads/${branch}`, { sha: newCommit.sha });
  return newCommit;
}

// Recursively read all files under a local dir → [{ path (repo-relative), content: Buffer }]
function readDirFiles(localDir, repoBase) {
  const results = [];
  if (!fs.existsSync(localDir)) return results;
  for (const entry of fs.readdirSync(localDir)) {
    const full = path.join(localDir, entry);
    if (fs.statSync(full).isDirectory()) {
      results.push(...readDirFiles(full, `${repoBase}/${entry}`));
    } else {
      results.push({ path: `${repoBase}/${entry}`, content: fs.readFileSync(full) });
    }
  }
  return results;
}

// Files that must be on main for the public app to work.
// admin.html / upload.html intentionally excluded — admin lives only on dev.
function infraFiles() {
  return [
    'server.js', 'package.json', 'package-lock.json',
    'public/index.html', 'public/style.css', 'public/script.js',
  ].filter(f => fs.existsSync(path.join(__dirname, f)))
   .map(f => ({ path: f, content: fs.readFileSync(path.join(__dirname, f)) }));
}

// ─── Admin PIN protection (only active when ADMIN_PIN env var is set) ─────────
// Set ADMIN_PIN on Railway to password-protect /admin.html and all /api/ admin routes.
// Locally (no ADMIN_PIN) everything remains open as before.
const ADMIN_PIN = process.env.ADMIN_PIN;
if (ADMIN_PIN) {
  const PROTECTED_PATHS = ['/admin.html', '/upload.html'];
  const PROTECTED_API   = ['/api/schedule', '/api/skins', '/api/skin/', '/api/upload-skin',
                           '/api/generate-skin', '/api/skin-template',
                           '/api/download-skin', '/api/deploy-to-main', '/api/revert-main-to-default'];
  app.use((req, res, next) => {
    const needsAuth = PROTECTED_PATHS.includes(req.path) ||
                      PROTECTED_API.some(p => req.path.startsWith(p));
    if (!needsAuth) return next();
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Basic ')) {
      const decoded  = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      const pass     = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
      if (pass.trim() === ADMIN_PIN.trim()) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Skin Admin"');
    res.status(401).send('Unauthorized');
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// ─── Active skin ──────────────────────────────────────────────────────────────
app.get('/api/active-skin', (req, res) => {
  const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, 'skin-schedule.json'), 'utf8'));
  const mmdd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(5); // MM-DD (sv-SE always gives YYYY-MM-DD)
  // Match by date AND require the skin folder to actually exist (otherwise stale
  // schedule entries pointing at deleted skins would 404 the stylesheet and the
  // page would silently fall back to the default ocean look).
  const active = schedule.find(s =>
    s.name !== 'default' &&
    mmdd >= s.start && mmdd <= s.end &&
    fs.existsSync(path.join(__dirname, 'public', 'skins', s.name, 'style.css'))
  );
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

// Delete a skin: remove from disk, remove schedule entry, push deletion to dev
app.delete('/api/skin/:name', async (req, res) => {
  const skinName = (req.params.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!skinName)              return res.status(400).json({ error: 'Skin name required' });
  if (skinName === 'default') return res.status(400).json({ error: 'Cannot delete the default skin' });

  const skinDir = path.join(SKINS_DIR, skinName);
  if (!fs.existsSync(skinDir)) return res.status(404).json({ error: 'Skin not found' });

  try {
    // Collect repo-relative paths of every file in the skin folder before deleting from disk
    const filesToDelete = readDirFiles(skinDir, `public/skins/${skinName}`).map(f => f.path);

    // Remove from disk
    fs.rmSync(skinDir, { recursive: true, force: true });

    // Update schedule (drop any entries referencing this skin)
    const schedule = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'));
    const cleaned  = schedule.filter(s => s.name !== skinName);
    const scheduleChanged = cleaned.length !== schedule.length;
    if (scheduleChanged) fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(cleaned, null, 2));

    // Push deletion + schedule update to dev
    let pushed = false, gitError = null;
    if (GITHUB_TOKEN) {
      try {
        await ghDeleteFiles(filesToDelete, `Delete skin: ${skinName}`, 'dev');
        if (scheduleChanged) {
          await ghCommitFiles(
            [{ path: 'skin-schedule.json', content: JSON.stringify(cleaned, null, 2) }],
            `Remove ${skinName} from schedule`, 'dev'
          );
        }
        pushed = true;
      } catch (e) { gitError = e.message; }
    } else {
      try {
        execSync(`git rm -rf "public/skins/${skinName}"`, { cwd: __dirname, stdio: 'pipe' });
        if (scheduleChanged) execSync('git add skin-schedule.json', { cwd: __dirname, stdio: 'pipe' });
        execSync(`git commit -m "Delete skin: ${skinName}"`, { cwd: __dirname, stdio: 'pipe' });
        execSync('git push origin dev', { cwd: __dirname, stdio: 'pipe' });
        pushed = true;
      } catch (e) { gitError = e.stderr?.toString() || e.message; }
    }

    res.json({ ok: true, name: skinName, pushed, gitError });
  } catch (err) {
    console.error('[delete-skin]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedule', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8')));
});

app.post('/api/schedule', express.json(), async (req, res) => {
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(req.body, null, 2));
  if (GITHUB_TOKEN) {
    try {
      await ghCommitFiles(
        [{ path: 'skin-schedule.json', content: JSON.stringify(req.body, null, 2) }],
        'Update skin schedule via admin', 'dev'
      );
      res.json({ ok: true, pushed: true });
    } catch (err) {
      console.error('[schedule push]', err.message);
      res.json({ ok: true, pushed: false, gitError: err.message });
    }
  } else {
    // Local git CLI fallback
    try {
      execSync('git add skin-schedule.json', { cwd: __dirname, stdio: 'pipe' });
      try { execSync('git commit -m "Update skin schedule via admin"', { cwd: __dirname, stdio: 'pipe' }); } catch (_) {}
      execSync('git push origin dev', { cwd: __dirname, stdio: 'pipe' });
      res.json({ ok: true, pushed: true });
    } catch (err) {
      res.json({ ok: true, pushed: false, gitError: err.message });
    }
  }
});

app.post('/api/deploy-to-main', express.json(), async (req, res) => {
  try {
    const schedule = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'));
    const mmdd     = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(5);
    const active   = schedule.find(s => s.name !== 'default' && mmdd >= s.start && mmdd <= s.end);
    if (!active) return res.status(400).json({ error: 'No skin is currently active on dev.' });

    const skinName = active.name;
    const skinSrc  = path.join(SKINS_DIR, skinName);
    if (!fs.existsSync(skinSrc)) return res.status(400).json({ error: `Skin folder not found: ${skinName}` });

    if (GITHUB_TOKEN) {
      const files = [
        ...infraFiles(),
        ...readDirFiles(path.join(SKINS_DIR, 'default'), 'public/skins/default'),
        ...readDirFiles(skinSrc, `public/skins/${skinName}`),
        { path: 'skin-schedule.json', content: JSON.stringify([active], null, 2) },
      ];
      await ghCommitFiles(files, `Deploy skin: ${skinName} (${active.start} → ${active.end})`, 'main');
      return res.json({ ok: true, skin: skinName });
    }

    // ── Local git CLI fallback (worktree) ──────────────────────────────────
    const WORKTREE = path.join(__dirname, '.main-deploy-worktree');
    if (fs.existsSync(WORKTREE)) execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' });
    execSync(`git fetch origin main`, { cwd: __dirname, stdio: 'pipe' });
    execSync(`git worktree add "${WORKTREE}" origin/main`, { cwd: __dirname, stdio: 'pipe' });
    for (const f of ['server.js','package.json','package-lock.json','public/index.html','public/style.css','public/script.js']) {
      const src = path.join(__dirname, f); const dst = path.join(WORKTREE, f);
      if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    }
    const defaultDst = path.join(WORKTREE, 'public', 'skins', 'default');
    fs.mkdirSync(defaultDst, { recursive: true });
    execSync(`xcopy /E /I /Y "${path.join(SKINS_DIR,'default')}" "${defaultDst}"`, { stdio: 'pipe' });
    const skinDest = path.join(WORKTREE, 'public', 'skins', skinName);
    fs.mkdirSync(skinDest, { recursive: true });
    execSync(`xcopy /E /I /Y "${skinSrc}" "${skinDest}"`, { stdio: 'pipe' });
    fs.writeFileSync(path.join(WORKTREE, 'skin-schedule.json'), JSON.stringify([active], null, 2));
    execSync(`git add -A`, { cwd: WORKTREE, stdio: 'pipe' });
    try { execSync(`git commit -m "Deploy skin: ${skinName} (${active.start} → ${active.end})"`, { cwd: WORKTREE, stdio: 'pipe' }); } catch (_) {}
    execSync(`git push origin HEAD:main`, { cwd: WORKTREE, stdio: 'pipe' });
    execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' });
    res.json({ ok: true, skin: skinName });
  } catch (err) {
    console.error('[deploy-to-main]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/revert-main-to-default', async (req, res) => {
  try {
    if (GITHUB_TOKEN) {
      const files = [
        ...infraFiles(),
        { path: 'skin-schedule.json', content: '[]' },
      ];
      await ghCommitFiles(files, 'Revert main to default ocean skin', 'main');
      return res.json({ ok: true });
    }

    // ── Local git CLI fallback (worktree) ──────────────────────────────────
    const WORKTREE = path.join(__dirname, '.main-deploy-worktree');
    if (fs.existsSync(WORKTREE)) execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' });
    execSync(`git fetch origin main`, { cwd: __dirname, stdio: 'pipe' });
    execSync(`git worktree add "${WORKTREE}" origin/main`, { cwd: __dirname, stdio: 'pipe' });
    for (const f of ['server.js','package.json','package-lock.json','public/index.html','public/style.css','public/script.js']) {
      const src = path.join(__dirname, f); const dst = path.join(WORKTREE, f);
      if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    }
    fs.writeFileSync(path.join(WORKTREE, 'skin-schedule.json'), '[]');
    execSync(`git add -A`, { cwd: WORKTREE, stdio: 'pipe' });
    try { execSync(`git commit -m "Revert main to default ocean skin"`, { cwd: WORKTREE, stdio: 'pipe' }); } catch (_) {}
    execSync(`git push origin HEAD:main`, { cwd: WORKTREE, stdio: 'pipe' });
    execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: __dirname, stdio: 'pipe' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[revert-main]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Skin Upload / Slicer ─────────────────────────────────────────────────────
// Source PNG: 1024 × 2180 (matches iPhone 1:2.13 aspect ratio).
// Slice heights tuned to match the real mobile CSS element proportions, so
// each slice's aspect ratio matches the element it fills (no cover-cropping
// or stretching). Section heights as % of 2180:
//   Header 30% │ Drum 10% │ Cols-gap 7% │ Weather 13% │ Wave 13% │ Wind 13%
//   Bunting 2% │ Sun 12%
const SKIN_SLICES = [
  { file: 'header-bg.png',       left: 0,   top: 0,    width: 1024, height: 654 },
  { file: 'drum-bg.png',         left: 0,   top: 654,  width: 1024, height: 218 },
  { file: 'weather-card-bg.png', left: 0,   top: 1024, width: 1024, height: 283 },
  { file: 'wave-row-bg.png',     left: 0,   top: 1307, width: 1024, height: 283 },
  { file: 'wind-row-bg.png',     left: 0,   top: 1590, width: 1024, height: 283 },
  { file: 'bunting-bg.png',      left: 0,   top: 1873, width: 1024, height: 44  },
  { file: 'sunset-bg.png',       left: 0,   top: 1917, width: 512,  height: 263 },
  { file: 'sunrise-bg.png',      left: 512, top: 1917, width: 512,  height: 263 },
];

const SOURCE_W = 1024;
const SOURCE_H = 2180;

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
.drum-wrapper { background: url('/skins/${name}/skin/drum-bg.png') center center / 100% 100% no-repeat; }
.wx-cell { background: url('/skins/${name}/skin/weather-card-bg.png') center center / 300% 100% no-repeat; }
#weatherRow .mx-cell:nth-child(1) { background-position: right center; }
#weatherRow .mx-cell:nth-child(2) { background-position: center center; }
#weatherRow .mx-cell:nth-child(3) { background-position: left center; }
.wv-cell { background: url('/skins/${name}/skin/wave-row-bg.png') center center / 300% 100% no-repeat; }
#waveRow .mx-cell:nth-child(1) { background-position: right center; }
#waveRow .mx-cell:nth-child(2) { background-position: center center; }
#waveRow .mx-cell:nth-child(3) { background-position: left center; }
.wd-cell { background: url('/skins/${name}/skin/wind-row-bg.png') center center / 300% 100% no-repeat; }
#windRow .mx-cell:nth-child(1) { background-position: right center; }
#windRow .mx-cell:nth-child(2) { background-position: center center; }
#windRow .mx-cell:nth-child(3) { background-position: left center; }
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

// Shared helper — takes a Jimp image, slices it, saves to disk, pushes to dev
async function processSkinImage(src, skinName) {
  // Aspect-ratio guard + auto-resize
  const inAspect     = src.bitmap.width / src.bitmap.height;
  const targetAspect = SOURCE_W / SOURCE_H;
  const aspectDelta  = Math.abs(inAspect - targetAspect) / targetAspect;
  if (aspectDelta > 0.15) {
    throw new Error(`Image aspect ratio (${src.bitmap.width}×${src.bitmap.height}) is too far from ${SOURCE_W}×${SOURCE_H}. ` +
                    `Got ratio 1:${(1/inAspect).toFixed(2)}, expected 1:${(1/targetAspect).toFixed(2)}.`);
  }
  if (src.bitmap.width !== SOURCE_W || src.bitmap.height !== SOURCE_H) {
    src.resize(SOURCE_W, SOURCE_H);
  }

  const skinDir  = path.join(SKINS_DIR, skinName);
  const assetDir = path.join(skinDir, 'skin');
  fs.mkdirSync(assetDir, { recursive: true });

  await Promise.all(SKIN_SLICES.map(s => {
    const crop = src.clone().crop(s.left, s.top, s.width, s.height);
    return crop.writeAsync(path.join(assetDir, s.file));
  }));

  fs.writeFileSync(path.join(skinDir, 'style.css'), skinCSS(skinName));

  let pushed = false, gitError = null;
  if (GITHUB_TOKEN) {
    try {
      const files = readDirFiles(skinDir, `public/skins/${skinName}`);
      await ghCommitFiles(files, `Add skin: ${skinName}`, 'dev');
      pushed = true;
    } catch (e) { gitError = e.message; }
  } else {
    try {
      execSync(`git add public/skins/${skinName}`, { cwd: __dirname, stdio: 'pipe' });
      execSync(`git commit -m "Add skin: ${skinName}"`, { cwd: __dirname, stdio: 'pipe' });
      execSync('git push origin dev', { cwd: __dirname, stdio: 'pipe' });
      pushed = true;
    } catch (e) { gitError = e.stderr?.toString() || e.message; }
  }
  return { pushed, gitError };
}

app.post('/api/upload-skin', upload.single('png'), async (req, res) => {
  try {
    const skinName = (req.body.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!skinName) return res.status(400).json({ error: 'Skin name is required' });
    if (!req.file)  return res.status(400).json({ error: 'PNG file is required' });

    const src = await Jimp.read(req.file.buffer);
    const { pushed, gitError } = await processSkinImage(src, skinName);
    res.json({ ok: true, name: skinName, pushed, gitError });
  } catch (err) {
    console.error('[upload-skin]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate skin from text prompt via Pollinations.ai (free, no auth, exact dims)
app.post('/api/generate-skin', express.json(), async (req, res) => {
  try {
    const skinName = (req.body.name   || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const prompt   = (req.body.prompt || '').trim();
    if (!skinName) return res.status(400).json({ error: 'Skin name is required' });
    if (!prompt)   return res.status(400).json({ error: 'Prompt is required' });

    // Pollinations endpoint — returns a PNG at exactly width × height
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
                `?width=${SOURCE_W}&height=${SOURCE_H}&nologo=true&enhance=true`;

    // Generation can take 30-90 s; allow plenty of time
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 120_000);
    let r;
    try {
      r = await fetch(url, { signal: ctrl.signal });
    } finally { clearTimeout(timeout); }
    if (!r.ok) return res.status(502).json({ error: `Pollinations returned ${r.status}` });
    const buf = Buffer.from(await r.arrayBuffer());

    const src = await Jimp.read(buf);
    const { pushed, gitError } = await processSkinImage(src, skinName);
    res.json({ ok: true, name: skinName, pushed, gitError });
  } catch (err) {
    console.error('[generate-skin]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generates a template grid PNG (1024×2180) with semi-transparent labelled
// boxes for every slice region — attach to GPT prompts so generated art
// lands in the right places.
app.get('/api/skin-template', async (req, res) => {
  try {
    const REGIONS = [
      { ...SKIN_SLICES[0], label: 'HEADER',     fill: 0x4FC3F7AA, border: 0x0D47A1FF }, // sky blue
      { ...SKIN_SLICES[1], label: 'DRUM',       fill: 0xFFB74DAA, border: 0xE65100FF }, // amber
      { ...SKIN_SLICES[2], label: 'WEATHER-ROW', fill: 0xA5D6A7AA, border: 0x2E7D32FF }, // green
      { ...SKIN_SLICES[3], label: 'WAVE-ROW',   fill: 0x80DEEAAA, border: 0x006064FF }, // teal
      { ...SKIN_SLICES[4], label: 'WIND-ROW',   fill: 0xCE93D8AA, border: 0x4A148CFF }, // purple
      { ...SKIN_SLICES[5], label: 'BUNTING',    fill: 0xFFCDD2AA, border: 0xB71C1CFF }, // red
      { ...SKIN_SLICES[6], label: 'SUNSET',     fill: 0xFFAB91AA, border: 0xBF360CFF }, // orange
      { ...SKIN_SLICES[7], label: 'SUNRISE',    fill: 0xFFF59DAA, border: 0xF57F17FF }, // yellow
    ];

    const img = new Jimp(SOURCE_W, SOURCE_H, 0xFFFFFFFF);

    // Load font for labels
    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

    for (const r of REGIONS) {
      // Fill region
      img.scan(r.left, r.top, r.width, r.height, function (x, y, idx) {
        this.bitmap.data[idx]     = (r.fill >>> 24) & 0xFF;
        this.bitmap.data[idx + 1] = (r.fill >>> 16) & 0xFF;
        this.bitmap.data[idx + 2] = (r.fill >>> 8)  & 0xFF;
        this.bitmap.data[idx + 3] = r.fill & 0xFF;
      });
      // Border (top, bottom, left, right – 4px thick)
      const drawBorder = (x, y, w, h) => img.scan(x, y, w, h, function (px, py, idx) {
        this.bitmap.data[idx]     = (r.border >>> 24) & 0xFF;
        this.bitmap.data[idx + 1] = (r.border >>> 16) & 0xFF;
        this.bitmap.data[idx + 2] = (r.border >>> 8)  & 0xFF;
        this.bitmap.data[idx + 3] = r.border & 0xFF;
      });
      drawBorder(r.left,             r.top,                    r.width, 4);
      drawBorder(r.left,             r.top + r.height - 4,     r.width, 4);
      drawBorder(r.left,             r.top,                    4,       r.height);
      drawBorder(r.left + r.width-4, r.top,                    4,       r.height);

      // Label centered in region
      const text = `${r.label}\n${r.width}×${r.height} @ ${r.left},${r.top}`;
      img.print(font, r.left + 12, r.top + 12, text, r.width - 24);
    }

    const buf = await img.getBufferAsync(Jimp.MIME_PNG);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="skin-template-${SOURCE_W}x${SOURCE_H}.png"`);
    res.end(buf);
  } catch (err) {
    console.error('[skin-template]', err.message);
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