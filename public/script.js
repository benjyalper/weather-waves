/**
 * script.js — Weather + Waves frontend logic
 *
 * Fetches data from our backend proxy (/api/weather and /api/marine),
 * maps codes to visual categories, renders SVG icons, and auto-refreshes.
 */

// ─── Location & Config ────────────────────────────────────────────────────────
// Change LAT / LON to display data for a different location
const LAT  = 32.6798;      // Latitude  (נווה ים)
const LON  = 34.9319;      // Longitude (נווה ים)
const CITY = 'נווה ים';    // City name shown in the header

// Auto-refresh interval: every 30 minutes
const REFRESH_MS = 30 * 60 * 1000;

// ─── Global state ─────────────────────────────────────────────────────────────
// Stored after first fetch so day-clicks can re-render without a new API call
let gWeatherData  = null;
let gMarineData   = null;
let gSelectedDay  = 0;   // index into daily.time[] — 0 = today

// ─── Hebrew Day Letters ───────────────────────────────────────────────────────
// JS getDay() → 0=Sunday … 6=Saturday
// Hebrew: א=Sun ב=Mon ג=Tue ד=Wed ה=Thu ו=Fri ש=Sat
const HEBREW_DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

// ─── Weather Code → Category ──────────────────────────────────────────────────
// WMO weather interpretation codes (see open-meteo docs)
function getWeatherCategory(code) {
  if (code === 0)                      return 'sunny';         // Clear sky
  if (code <= 2)                       return 'partly-cloudy'; // Mainly/partly clear
  if (code <= 48)                      return 'cloudy';        // Overcast / fog
  if (code >= 51 && code <= 82)        return 'rainy';         // Drizzle / rain / showers
  if (code >= 85 && code <= 86)        return 'rainy';         // Snow showers
  if (code >= 95)                      return 'stormy';        // Thunderstorm
  return 'cloudy';
}

// Weather emoji used in the forecast calendar cells
const WEATHER_EMOJI = {
  'sunny':         '☀️',
  'partly-cloudy': '⛅',
  'cloudy':        '☁️',
  'rainy':         '🌧️',
  'stormy':        '⛈️'
};

// Hebrew label for each weather category
const WEATHER_LABELS = {
  'sunny':         'שמשי',
  'partly-cloudy': 'מעונן חלקית',
  'cloudy':        'מעונן',
  'rainy':         'גשום',
  'stormy':        'סוערת'
};

// ─── Wave Height → Category ───────────────────────────────────────────────────
function getWaveCategory(height) {
  if (height <= 0.30) return 'flat';    // 0 – 0.3 m
  if (height <= 0.80) return 'small';   // 0.31 – 0.8 m
  if (height <= 1.50) return 'medium';  // 0.81 – 1.5 m
  return 'high';                         // 1.5+ m
}

// Hebrew label for each wave category
const WAVE_LABELS = {
  'flat':   'ים שקט',
  'small':  'גלים קטנים',
  'medium': 'גלים בינוניים',
  'high':   'גלים גבוהים'
};

// ─── SVG Icons: Weather ───────────────────────────────────────────────────────

function iconSunny() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="sg" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="#FFF59D"/>
        <stop offset="100%" stop-color="#FFA000"/>
      </radialGradient>
    </defs>
    <!-- Rays -->
    <g stroke="#FFB300" stroke-width="5" stroke-linecap="round" opacity="0.85">
      <line x1="60" y1="8"  x2="60" y2="24"/>
      <line x1="60" y1="96" x2="60" y2="112"/>
      <line x1="8"  y1="60" x2="24" y2="60"/>
      <line x1="96" y1="60" x2="112" y2="60"/>
      <line x1="22" y1="22" x2="33" y2="33"/>
      <line x1="87" y1="87" x2="98" y2="98"/>
      <line x1="98" y1="22" x2="87" y2="33"/>
      <line x1="22" y1="98" x2="33" y2="87"/>
    </g>
    <!-- Sun body -->
    <circle cx="60" cy="60" r="27" fill="url(#sg)" stroke="#FFC107" stroke-width="2"/>
    <!-- Soft glare -->
    <circle cx="50" cy="50" r="9" fill="rgba(255,255,255,0.28)"/>
  </svg>`;
}

function iconPartlyCloudy() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="sg2" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="#FFF59D"/>
        <stop offset="100%" stop-color="#FFA000"/>
      </radialGradient>
    </defs>
    <!-- Sun (partially behind cloud) -->
    <g opacity="0.92">
      <g stroke="#FFB300" stroke-width="3.5" stroke-linecap="round" opacity="0.75">
        <line x1="32" y1="14" x2="32" y2="26"/>
        <line x1="7"  y1="39" x2="19" y2="39"/>
        <line x1="15" y1="21" x2="23" y2="29"/>
        <line x1="50" y1="21" x2="42" y2="29"/>
        <line x1="56" y1="39" x2="44" y2="39"/>
      </g>
      <circle cx="32" cy="39" r="19" fill="url(#sg2)"/>
    </g>
    <!-- Cloud front -->
    <ellipse cx="74" cy="73" rx="34" ry="20" fill="#ECEFF1"/>
    <ellipse cx="54" cy="79" rx="21" ry="15" fill="#ECEFF1"/>
    <ellipse cx="57" cy="65" rx="19" ry="18" fill="#CFD8DC"/>
    <ellipse cx="76" cy="60" rx="23" ry="20" fill="#ECEFF1"/>
    <ellipse cx="90" cy="70" rx="17" ry="14" fill="#ECEFF1"/>
    <rect x="34" y="70" width="72" height="20" rx="10" fill="#ECEFF1"/>
  </svg>`;
}

function iconCloudy() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <!-- Back cloud -->
    <ellipse cx="77" cy="56" rx="29" ry="19" fill="#B0BEC5"/>
    <ellipse cx="57" cy="49" rx="23" ry="21" fill="#CFD8DC"/>
    <!-- Main cloud -->
    <ellipse cx="60" cy="74" rx="38" ry="21" fill="#ECEFF1"/>
    <ellipse cx="40" cy="70" rx="22" ry="18" fill="#ECEFF1"/>
    <ellipse cx="48" cy="58" rx="21" ry="19" fill="#CFD8DC"/>
    <ellipse cx="70" cy="55" rx="25" ry="21" fill="#ECEFF1"/>
    <ellipse cx="88" cy="68" rx="18" ry="14" fill="#ECEFF1"/>
    <rect x="20" y="68" width="84" height="22" rx="11" fill="#ECEFF1"/>
  </svg>`;
}

function iconRainy() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <!-- Dark rain cloud -->
    <ellipse cx="60" cy="54" rx="38" ry="20" fill="#78909C"/>
    <ellipse cx="40" cy="50" rx="22" ry="19" fill="#90A4AE"/>
    <ellipse cx="48" cy="40" rx="20" ry="18" fill="#78909C"/>
    <ellipse cx="70" cy="37" rx="24" ry="20" fill="#90A4AE"/>
    <ellipse cx="88" cy="50" rx="18" ry="14" fill="#78909C"/>
    <rect x="20" y="50" width="82" height="18" rx="9" fill="#78909C"/>
    <!-- Rain drops -->
    <g fill="#42A5F5">
      <ellipse cx="38"  cy="87"  rx="3" ry="6.5" transform="rotate(-12 38 87)"/>
      <ellipse cx="54"  cy="96"  rx="3" ry="6.5" transform="rotate(-12 54 96)"/>
      <ellipse cx="70"  cy="83"  rx="3" ry="6.5" transform="rotate(-12 70 83)"/>
      <ellipse cx="85"  cy="93"  rx="3" ry="6.5" transform="rotate(-12 85 93)"/>
      <ellipse cx="46"  cy="105" rx="3" ry="6.5" transform="rotate(-12 46 105)"/>
      <ellipse cx="78"  cy="103" rx="3" ry="6.5" transform="rotate(-12 78 103)"/>
    </g>
  </svg>`;
}

function iconStormy() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <!-- Very dark storm cloud -->
    <ellipse cx="60" cy="46" rx="40" ry="21" fill="#455A64"/>
    <ellipse cx="40" cy="43" rx="23" ry="19" fill="#546E7A"/>
    <ellipse cx="48" cy="33" rx="21" ry="18" fill="#455A64"/>
    <ellipse cx="72" cy="30" rx="26" ry="20" fill="#546E7A"/>
    <ellipse cx="90" cy="44" rx="18" ry="14" fill="#455A64"/>
    <rect x="18" y="44" width="84" height="18" rx="9" fill="#455A64"/>
    <!-- Lightning bolt -->
    <polygon
      points="67,63 56,81 64,81 54,102 78,76 66,76 76,63"
      fill="#FFD600" stroke="#FF8F00" stroke-width="1.5" stroke-linejoin="round"/>
    <!-- Light rain on sides -->
    <g fill="#81D4FA" opacity="0.65">
      <ellipse cx="32"  cy="78"  rx="2.5" ry="5.5" transform="rotate(-12 32 78)"/>
      <ellipse cx="92"  cy="76"  rx="2.5" ry="5.5" transform="rotate(-12 92 76)"/>
      <ellipse cx="34"  cy="93"  rx="2.5" ry="5.5" transform="rotate(-12 34 93)"/>
      <ellipse cx="94"  cy="91"  rx="2.5" ry="5.5" transform="rotate(-12 94 91)"/>
    </g>
  </svg>`;
}

// ─── SVG Icons: Waves ─────────────────────────────────────────────────────────

function iconWaveFlat() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="wf" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stop-color="#81D4FA"/>
        <stop offset="100%" stop-color="#0288D1"/>
      </linearGradient>
    </defs>
    <!-- Sky -->
    <rect x="0" y="0" width="120" height="62" fill="#E1F5FE" rx="0"/>
    <!-- Sea body -->
    <rect x="0" y="62" width="120" height="58" fill="url(#wf)"/>
    <!-- Surface ripples (very gentle) -->
    <path d="M0,62 Q15,59 30,62 Q45,65 60,62 Q75,59 90,62 Q105,65 120,62"
          fill="#B3E5FC" stroke="none" opacity="0.6"/>
    <path d="M0,68 Q20,66 40,68 Q60,70 80,68 Q100,66 120,68"
          fill="none" stroke="#4FC3F7" stroke-width="1.5" opacity="0.45"/>
    <!-- Sun reflection on water -->
    <ellipse cx="60" cy="66" rx="28" ry="4" fill="rgba(255,255,255,0.22)"/>
    <!-- Horizon glow -->
    <line x1="0" y1="62" x2="120" y2="62" stroke="#29B6F6" stroke-width="1.5" opacity="0.7"/>
  </svg>`;
}

function iconWaveSmall() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="ws" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stop-color="#29B6F6"/>
        <stop offset="100%" stop-color="#0277BD"/>
      </linearGradient>
    </defs>
    <!-- Sky -->
    <rect x="0" y="0" width="120" height="70" fill="#E1F5FE"/>
    <!-- Wave shape fills sea area -->
    <path d="M0,70 Q15,58 30,70 Q45,82 60,70 Q75,58 90,70 Q105,82 120,70 L120,120 L0,120 Z"
          fill="url(#ws)"/>
    <!-- Light foam on crest -->
    <path d="M4,67  Q14,61 24,66" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.65"/>
    <path d="M34,67 Q44,61 54,66" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.65"/>
    <path d="M64,67 Q74,61 84,66" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.65"/>
    <path d="M94,67 Q104,61 114,66" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.65"/>
  </svg>`;
}

function iconWaveMedium() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="wm" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stop-color="#039BE5"/>
        <stop offset="100%" stop-color="#01579B"/>
      </linearGradient>
    </defs>
    <!-- Sky -->
    <rect x="0" y="0" width="120" height="72" fill="#E3F2FD"/>
    <!-- Medium waves -->
    <path d="M0,72 Q20,38 40,72 Q60,106 80,72 Q100,38 120,72 L120,120 L0,120 Z"
          fill="url(#wm)"/>
    <!-- Foam arcs on wave peaks -->
    <path d="M0,68  Q10,56 20,62 Q28,68 38,58"
          fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.72"/>
    <path d="M80,68 Q90,56 100,62 Q108,68 118,58"
          fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.72"/>
    <!-- Spray dots at peaks -->
    <g fill="white" opacity="0.7">
      <circle cx="37" cy="50" r="2.2"/>
      <circle cx="43" cy="44" r="1.7"/>
      <circle cx="30" cy="47" r="1.5"/>
    </g>
    <g fill="white" opacity="0.7">
      <circle cx="117" cy="50" r="2.2"/>
      <circle cx="111" cy="44" r="1.7"/>
      <circle cx="110" cy="51" r="1.5"/>
    </g>
  </svg>`;
}

function iconWaveHigh() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="wh" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stop-color="#0277BD"/>
        <stop offset="100%" stop-color="#01579B"/>
      </linearGradient>
      <linearGradient id="whcrest" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stop-color="#29B6F6"/>
        <stop offset="50%"  stop-color="#81D4FA"/>
        <stop offset="100%" stop-color="#0288D1"/>
      </linearGradient>
    </defs>
    <!-- Sky (darker/dramatic) -->
    <rect x="0" y="0" width="120" height="76" fill="#BBDEFB"/>
    <!-- Big waves -->
    <path d="M0,76 Q20,14 40,76 Q60,138 80,76 Q100,14 120,76 L120,120 L0,120 Z"
          fill="url(#wh)"/>
    <!-- Crest highlight -->
    <path d="M-4,70 Q18,8 40,70"
          fill="none" stroke="url(#whcrest)" stroke-width="6" stroke-linecap="round" opacity="0.75"/>
    <path d="M80,70 Q102,8 124,70"
          fill="none" stroke="url(#whcrest)" stroke-width="6" stroke-linecap="round" opacity="0.75"/>
    <!-- Big foam arcs -->
    <path d="M20,32 Q30,20 42,28 Q52,36 40,42"
          fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" opacity="0.82"/>
    <path d="M80,32 Q90,20 102,28 Q112,36 100,42"
          fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" opacity="0.82"/>
    <!-- Spray particles at top of waves -->
    <g fill="white" opacity="0.8">
      <circle cx="38" cy="16" r="3"/>
      <circle cx="45" cy="10" r="2.2"/>
      <circle cx="30" cy="13" r="2"/>
      <circle cx="50" cy="18" r="1.8"/>
    </g>
    <g fill="white" opacity="0.8">
      <circle cx="98" cy="16" r="3"/>
      <circle cx="105" cy="10" r="2.2"/>
      <circle cx="90"  cy="13" r="2"/>
      <circle cx="110" cy="18" r="1.8"/>
    </g>
  </svg>`;
}

// ─── Icon selector maps ───────────────────────────────────────────────────────
const WEATHER_ICONS = {
  'sunny':         iconSunny,
  'partly-cloudy': iconPartlyCloudy,
  'cloudy':        iconCloudy,
  'rainy':         iconRainy,
  'stormy':        iconStormy
};

const WAVE_ICONS = {
  'flat':   iconWaveFlat,
  'small':  iconWaveSmall,
  'medium': iconWaveMedium,
  'high':   iconWaveHigh
};

// ─── Wind & Wave Animation ────────────────────────────────────────────────────

let leafletMap  = null;   // Leaflet map instance (created once)
let windAnimId  = null;   // requestAnimationFrame handle for wind
let waveAnimId  = null;   // requestAnimationFrame handle for wave canvas

// Wind speed (km/h) → particle colour
// Darker tones so particles are visible on both sea and land tiles
function windColour(kmh, alpha) {
  if (kmh <  10) return `rgba( 30, 100, 210, ${alpha})`;  // calm   — dark blue
  if (kmh <  30) return `rgba(  0, 160, 100, ${alpha})`;  // light  — teal
  if (kmh <  50) return `rgba(200, 130,   0, ${alpha})`;  // strong — amber
  return                 `rgba(210,  30,  30, ${alpha})`;  // storm  — red
}

// Degrees (meteorological) → Hebrew compass label
function windDirHebrew(deg) {
  const dirs = ['צפון','צפון-מזרח','מזרח','דרום-מזרח','דרום','דרום-מערב','מערב','צפון-מערב'];
  return dirs[Math.round(deg / 45) % 8];
}

// Initialise Leaflet map once (dark CartoDB tiles, no API key needed)
function initLeafletMap() {
  if (leafletMap) return;

  leafletMap = L.map('windMap', {
    center: [LAT, LON],
    zoom: 13,
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    keyboard: false,
    attributionControl: true
  });

  // Standard OpenStreetMap tiles — Hebrew + English labels, city shown on map
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(leafletMap);


}

// Animated wind-particle system on the canvas overlay
// Uses clearRect each frame + trail history so the Leaflet map shows through
function startWindAnimation(speedKmh, dirDeg) {
  const canvas = document.getElementById('windCanvas');
  if (!canvas) return;

  if (windAnimId) { cancelAnimationFrame(windAnimId); windAnimId = null; }

  const wrapper = canvas.parentElement;
  // getBoundingClientRect gives the true rendered size (offsetWidth can lag layout)
  const rect    = wrapper.getBoundingClientRect();
  canvas.width  = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');

  // Meteorological direction = where wind comes FROM → flip 180° to get travel vector
  const travelDeg = (dirDeg + 180) % 360;
  const rad       = travelDeg * Math.PI / 180;
  const speed     = Math.max(0.5, speedKmh * 0.038);
  const vx = Math.sin(rad) * speed;
  const vy = -Math.cos(rad) * speed;

  const N         = 220;
  const MAX_TRAIL = 14; // positions stored per particle → visible trail length

  function spawnPos(random) {
    if (random) return { x: Math.random() * W, y: Math.random() * H };
    // spawn from the upwind edge so particles travel across the whole map
    if (Math.abs(vx) >= Math.abs(vy)) {
      return { x: vx > 0 ? 0 : W, y: Math.random() * H };
    }
    return { x: Math.random() * W, y: vy > 0 ? 0 : H };
  }

  const particles = Array.from({ length: N }, () => {
    const pos = spawnPos(true);
    return {
      x: pos.x, y: pos.y,
      history: [],
      age:  Math.floor(Math.random() * 80),
      life: 55 + Math.random() * 65,
      spd:  0.5 + Math.random() * 0.9
    };
  });

  function frame() {
    // Clear to transparent every frame — Leaflet map tiles show through
    ctx.clearRect(0, 0, W, H);

    particles.forEach(p => {
      // Store position in trail, limit length
      p.history.push({ x: p.x, y: p.y });
      if (p.history.length > MAX_TRAIL) p.history.shift();

      p.x  += vx * p.spd;
      p.y  += vy * p.spd;
      p.age++;

      // Draw trail: older segments are more transparent
      const lifeFade = Math.sin((p.age / p.life) * Math.PI);
      for (let i = 1; i < p.history.length; i++) {
        const t     = i / p.history.length;          // 0=tail, 1=head
        const alpha = t * lifeFade * 0.88;
        ctx.strokeStyle = windColour(speedKmh, alpha);
        ctx.lineWidth   = 0.8 + t * 0.9;
        ctx.beginPath();
        ctx.moveTo(p.history[i - 1].x, p.history[i - 1].y);
        ctx.lineTo(p.history[i].x,     p.history[i].y);
        ctx.stroke();
      }

      if (p.age >= p.life || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) {
        const pos = spawnPos(false);
        p.x = pos.x; p.y = pos.y;
        p.history = [];
        p.age  = 0;
        p.life = 55 + Math.random() * 65;
        p.spd  = 0.5 + Math.random() * 0.9;
      }
    });

    windAnimId = requestAnimationFrame(frame);
  }
  frame();
}

// Animated wave layers inside the wave card canvas
function startWaveAnimation(waveHeightM, waveDirDeg) {
  const canvas = document.getElementById('waveCanvas');
  if (!canvas) return;

  if (waveAnimId) { cancelAnimationFrame(waveAnimId); waveAnimId = null; }

  canvas.width  = canvas.offsetWidth  || canvas.parentElement.offsetWidth;
  canvas.height = canvas.offsetHeight || 80;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');

  // Amplitude scales with wave height (capped so it stays inside the canvas)
  const amplitude = Math.min(H * 0.38, Math.max(4, waveHeightM * 10));
  const numLayers = 3;

  // Wave direction (oceanographic: direction waves travel TOWARD)
  const dirRad = (waveDirDeg ?? 270) * Math.PI / 180;
  const phaseSpeedX =  Math.sin(dirRad) * 0.045;  // horizontal phase advance
  const phaseSpeedY = -Math.cos(dirRad) * 0.02;    // slight vertical drift

  let phase = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < numLayers; i++) {
      const layerOffset = (i / numLayers) * Math.PI * 2;
      const yBase       = H * (0.30 + i * 0.18);
      const opacity     = 0.25 + (i / numLayers) * 0.45;
      const amp         = amplitude * (1 - i * 0.22);

      // Wave path
      ctx.beginPath();
      ctx.moveTo(0, yBase);
      for (let x = 0; x <= W; x += 2) {
        const y = yBase + Math.sin((x / W) * Math.PI * 3.5 + phase + layerOffset) * amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, yBase - amp, 0, H);
      grad.addColorStop(0, `rgba(41, 182, 246, ${opacity})`);
      grad.addColorStop(1, `rgba(1,  87, 155, ${opacity * 0.45})`);
      ctx.fillStyle = grad;
      ctx.fill();

      // White crest highlight
      ctx.beginPath();
      ctx.moveTo(0, yBase);
      for (let x = 0; x <= W; x += 2) {
        const y = yBase + Math.sin((x / W) * Math.PI * 3.5 + phase + layerOffset) * amp;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.55})`;
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    phase += phaseSpeedX || 0.04;
    waveAnimId = requestAnimationFrame(frame);
  }
  frame();
}

// ─── Time slots definition ────────────────────────────────────────────────────
// Three representative hours shown inside each card
const TIME_SLOTS = [
  { key: 'morning', label: 'בוקר',    hour: 8  },
  { key: 'noon',    label: 'צהריים',  hour: 13 },
  { key: 'evening', label: 'ערב',     hour: 19 },
];

// Returns 'morning' | 'noon' | 'evening' based on the current local hour
function getCurrentSlotKey() {
  const h = new Date().getHours();
  if (h < 11)  return 'morning';
  if (h < 17)  return 'noon';
  return 'evening';
}

// Find index of a specific hour on a specific date in an hourly time array
// timeArray entries look like "2024-01-15T08:00"
function findHourIndex(timeArray, dateStr, hour) {
  const target = `${dateStr}T${String(hour).padStart(2, '0')}:00`;
  const idx = timeArray.findIndex(t => t === target);
  if (idx !== -1) return idx;
  // Fallback: nearest entry for that day
  return timeArray.findIndex(t => t.startsWith(dateStr));
}

// ─── Hebrew full day names (for the "viewing" label) ─────────────────────────
const HEBREW_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// ─── Render both cards for a specific forecast day index ─────────────────────
// dayIdx = 0 → today, dayIdx > 0 → future days
function renderDay(dayIdx) {
  gSelectedDay = dayIdx;

  // ── Highlight active cell in calendar ──
  document.querySelectorAll('.day-cell').forEach((cell, i) => {
    cell.classList.toggle('active', i === dayIdx);
  });

  // ── Update "viewing" label ──
  const viewingEl = document.getElementById('viewingLabel');
  if (dayIdx === 0) {
    viewingEl.textContent = 'היום';
  } else {
    const date      = new Date(gWeatherData.daily.time[dayIdx] + 'T12:00:00');
    const dayOfWeek = date.getDay();
    viewingEl.textContent = `יום ${HEBREW_DAY_NAMES[dayOfWeek]}`;
  }

  const daily        = gWeatherData?.daily;
  const wHourly      = gWeatherData?.hourly;   // weather hourly (temp + code)
  const marineHourly = gMarineData?.hourly;    // marine hourly (waves + sea temp)
  if (!daily || !wHourly || !marineHourly) return;

  const dateStr       = daily.time[dayIdx];
  const activeSlotKey = dayIdx === 0 ? getCurrentSlotKey() : null; // highlight for today

  // ── Build weather slots ──
  const weatherSlots = document.getElementById('weatherSlots');
  weatherSlots.innerHTML = '';

  TIME_SLOTS.forEach(({ key, label, hour }) => {
    const idx      = findHourIndex(wHourly.time, dateStr, hour);
    const temp     = idx !== -1 ? Math.round(wHourly.temperature_2m[idx]) : null;
    const code     = idx !== -1 ? wHourly.weathercode[idx]                : null;
    const category = code != null ? getWeatherCategory(code) : 'cloudy';
    const emoji    = WEATHER_EMOJI[category];
    const isActive = key === activeSlotKey;

    const slot = document.createElement('div');
    slot.className = 'time-slot' + (isActive ? ' active' : '');
    slot.innerHTML = `
      <span class="slot-label">${label}</span>
      <span class="slot-icon">${emoji}</span>
      <span class="slot-value">${temp != null ? temp + '°' : '--'}</span>
      <span class="slot-sub">${temp != null ? WEATHER_LABELS[category] : ''}</span>
    `;
    weatherSlots.appendChild(slot);
  });

  // ── Build wave slots ──
  const waveSlots = document.getElementById('waveSlots');
  waveSlots.innerHTML = '';

  TIME_SLOTS.forEach(({ key, label, hour }) => {
    const idx        = findHourIndex(marineHourly.time, dateStr, hour);
    const waveHeight = idx !== -1 ? marineHourly.wave_height?.[idx]             : null;
    const waterTemp  = idx !== -1 ? marineHourly.sea_surface_temperature?.[idx] : null;
    const category   = waveHeight != null ? getWaveCategory(waveHeight) : 'flat';
    const isActive   = key === activeSlotKey;

    const slot = document.createElement('div');
    slot.className = 'time-slot wave-slot' + (isActive ? ' active' : '');
    slot.innerHTML = `
      <span class="slot-label">${label}</span>
      <span class="slot-icon">🌊</span>
      <span class="slot-value">${waveHeight != null ? waveHeight.toFixed(1) + ' m' : '--'}</span>
      <span class="slot-sub">${waterTemp != null ? '🌡 ' + Math.round(waterTemp) + '°C' : '--'}</span>
    `;
    waveSlots.appendChild(slot);
  });

  // ── Wind map + wave canvas animations ──
  // Use the active time-slot hour (today) or noon (future days) as representative
  const animHour = dayIdx === 0
    ? TIME_SLOTS.find(s => s.key === getCurrentSlotKey()).hour
    : 13;
  const wIdx = findHourIndex(wHourly.time, dateStr, animHour);
  const mIdx = findHourIndex(marineHourly.time, dateStr, animHour);

  const windSpeedKmh = wIdx !== -1 ? (wHourly.wind_speed_10m?.[wIdx]      ?? 0)   : 0;
  const windDirDeg   = wIdx !== -1 ? (wHourly.wind_direction_10m?.[wIdx]  ?? 0)   : 0;
  const waveDirDeg   = mIdx !== -1 ? (marineHourly.wave_direction?.[mIdx] ?? 270) : 270;
  const waveHeightM  = mIdx !== -1 ? (marineHourly.wave_height?.[mIdx]    ?? 0.5) : 0.5;

  document.getElementById('windBadge').textContent =
    `${Math.round(windSpeedKmh)} km/h · ${windDirHebrew(windDirDeg)}`;

  renderSunTimes(gWeatherData.daily, dayIdx);

  initLeafletMap();
  startWindAnimation(windSpeedKmh, windDirDeg);
  startWaveAnimation(waveHeightM,  waveDirDeg);
}

// ─── Render sunrise / sunset for the selected day ────────────────────────────
function renderSunTimes(daily, dayIdx) {
  const el = document.getElementById('sunTimes');
  if (!el) return;
  if (!daily || !daily.sunrise || !daily.sunset) { el.innerHTML = ''; return; }

  const riseRaw = daily.sunrise[dayIdx] || '';
  const setRaw  = daily.sunset[dayIdx]  || '';

  // Times come as "2025-03-28T05:42" — extract HH:MM
  const rise = riseRaw.slice(11, 16);
  const set  = setRaw.slice(11, 16);

  el.innerHTML = `
    <span class="sun-item"><span class="sun-icon">🌅</span>${rise}</span>
    <span class="sun-item"><span class="sun-icon">🌇</span>${set}</span>
  `;
}

// ─── Build the forecast calendar in the header ───────────────────────────────
// Accepts the `daily` object from Open-Meteo and renders 7 day cells,
// each showing: Hebrew day letter + weather emoji + max temperature.
function buildCalendar(daily) {
  const container = document.getElementById('calendar');
  container.innerHTML = '';
  const todayStr = new Date().toISOString().slice(0, 10); // "2025-03-22"

  // If no forecast data yet, fall back to plain letter cells
  if (!daily || !daily.time) {
    HEBREW_DAYS.forEach((letter, i) => {
      const cell = document.createElement('div');
      cell.className = 'day-cell' + (i === new Date().getDay() ? ' today' : '');
      cell.innerHTML = `<span class="day-letter">${letter}</span>`;
      container.appendChild(cell);
    });
    document.getElementById('cityLabel').textContent = CITY;
    return;
  }

  daily.time.forEach((dateStr, i) => {
    // Use noon local time to avoid UTC date-shift edge cases
    const date       = new Date(dateStr + 'T12:00:00');
    const dayOfWeek  = date.getDay();                          // 0=Sun…6=Sat
    const letter     = HEBREW_DAYS[dayOfWeek];
    const isToday    = dateStr === todayStr;
    const category   = getWeatherCategory(daily.weathercode[i]);
    const emoji      = WEATHER_EMOJI[category];
    const maxTemp    = Math.round(daily.temperature_2m_max[i]);

    const cell = document.createElement('div');
    cell.className = 'day-cell' + (isToday ? ' today' : '');
    if (i === gSelectedDay) cell.classList.add('active');
    cell.title = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][dayOfWeek];
    cell.style.cursor = 'pointer';
    cell.innerHTML = `
      <span class="day-letter">${letter}</span>
      <span class="day-icon">${emoji}</span>
      <span class="day-temp">${maxTemp}°</span>
    `;
    // Click → show that day's weather + waves in the cards
    cell.addEventListener('click', () => renderDay(i));
    container.appendChild(cell);
  });

  document.getElementById('cityLabel').textContent = CITY;
}

// ─── Show / hide loading overlay ─────────────────────────────────────────────
function setLoading(on) {
  const el = document.getElementById('loadingOverlay');
  if (on) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// ─── Show or clear error banner ───────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('errorBanner');
  if (msg) {
    el.textContent = msg;
    el.classList.add('visible');
  } else {
    el.textContent = '';
    el.classList.remove('visible');
  }
}


// ─── Update "last updated" timestamp in footer ────────────────────────────────
function updateTimestamp() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('lastUpdated').textContent = `עודכן לאחרונה: ${hh}:${mm}`;
}

// ─── Main fetch: get weather + marine data together ───────────────────────────
async function fetchAllData() {
  setLoading(true);
  showError('');

  try {
    // Fetch both APIs in parallel for speed
    const [weatherRes, marineRes] = await Promise.all([
      fetch(`/api/weather?lat=${LAT}&lon=${LON}`),
      fetch(`/api/marine?lat=${LAT}&lon=${LON}`)
    ]);

    if (!weatherRes.ok) throw new Error(`Weather API error: ${weatherRes.status}`);
    if (!marineRes.ok)  throw new Error(`Marine API error: ${marineRes.status}`);

    gWeatherData = await weatherRes.json();
    gMarineData  = await marineRes.json();

    buildCalendar(gWeatherData.daily);  // populate calendar with real forecast
    renderDay(gSelectedDay);            // render cards for the selected day
    updateTimestamp();

  } catch (err) {
    console.error('Fetch error:', err);
    showError('שגיאה בטעינת הנתונים. בדוק חיבור לאינטרנט.');
  } finally {
    setLoading(false);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
buildCalendar(null);  // render plain letters immediately while loading
fetchAllData();       // fetch data, then replace with full forecast calendar

// Auto-refresh every 30 minutes
setInterval(fetchAllData, REFRESH_MS);
