/**
 * script.js — איים בזרם נווה ים
 *
 * Fetches weather (Open-Meteo) + marine data, renders a 7-day drum picker
 * and a 4-row matrix: sun times · weather · waves · wind maps.
 */

// ─── Location & Config ────────────────────────────────────────────────────────
const LAT  = 32.6798;   // Neve Yam
const LON  = 34.9319;
const CITY = 'נווה ים';

const REFRESH_MS = 30 * 60 * 1000;   // auto-refresh every 30 min

// ─── Global state ─────────────────────────────────────────────────────────────
let gWeatherData = null;
let gMarineData  = null;
let gSelectedDay = 0;

// ─── Hebrew helpers ────────────────────────────────────────────────────────────
// JS getDay() → 0=Sun … 6=Sat   /   Hebrew: א=Sun ב=Mon ג=Tue ד=Wed ה=Thu ו=Fri ש=Sat
const HEBREW_DAYS      = ['א','ב','ג','ד','ה','ו','ש'];
const HEBREW_DAY_NAMES = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

// ─── Weather Code → Category ──────────────────────────────────────────────────
function getWeatherCategory(code) {
  if (code === 0)               return 'sunny';
  if (code <= 2)                return 'partly-cloudy';
  if (code <= 48)               return 'cloudy';
  if (code >= 51 && code <= 82) return 'rainy';
  if (code >= 85 && code <= 86) return 'rainy';
  if (code >= 95)               return 'stormy';
  return 'cloudy';
}

const WEATHER_EMOJI = {
  'sunny': '☀️', 'partly-cloudy': '⛅', 'cloudy': '☁️',
  'rainy': '🌧️', 'stormy': '⛈️'
};

// ─── Wave Height → Category ───────────────────────────────────────────────────
function getWaveCategory(h) {
  if (h <= 0.30) return 'flat';
  if (h <= 0.80) return 'small';
  if (h <= 1.50) return 'medium';
  return 'high';
}

// ─── SVG Icons: Weather ───────────────────────────────────────────────────────

function iconSunny() {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="sg" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="#FFF59D"/>
        <stop offset="100%" stop-color="#FFA000"/>
      </radialGradient>
    </defs>
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
    <circle cx="60" cy="60" r="27" fill="url(#sg)" stroke="#FFC107" stroke-width="2"/>
    <circle cx="50" cy="50" r="9"  fill="rgba(255,255,255,0.28)"/>
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
    <ellipse cx="77" cy="56" rx="29" ry="19" fill="#B0BEC5"/>
    <ellipse cx="57" cy="49" rx="23" ry="21" fill="#CFD8DC"/>
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
    <ellipse cx="60" cy="54" rx="38" ry="20" fill="#78909C"/>
    <ellipse cx="40" cy="50" rx="22" ry="19" fill="#90A4AE"/>
    <ellipse cx="48" cy="40" rx="20" ry="18" fill="#78909C"/>
    <ellipse cx="70" cy="37" rx="24" ry="20" fill="#90A4AE"/>
    <ellipse cx="88" cy="50" rx="18" ry="14" fill="#78909C"/>
    <rect x="20" y="50" width="82" height="18" rx="9" fill="#78909C"/>
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
    <ellipse cx="60" cy="46" rx="40" ry="21" fill="#455A64"/>
    <ellipse cx="40" cy="43" rx="23" ry="19" fill="#546E7A"/>
    <ellipse cx="48" cy="33" rx="21" ry="18" fill="#455A64"/>
    <ellipse cx="72" cy="30" rx="26" ry="20" fill="#546E7A"/>
    <ellipse cx="90" cy="44" rx="18" ry="14" fill="#455A64"/>
    <rect x="18" y="44" width="84" height="18" rx="9" fill="#455A64"/>
    <polygon points="67,63 56,81 64,81 54,102 78,76 66,76 76,63"
      fill="#FFD600" stroke="#FF8F00" stroke-width="1.5" stroke-linejoin="round"/>
    <g fill="#81D4FA" opacity="0.65">
      <ellipse cx="32" cy="78"  rx="2.5" ry="5.5" transform="rotate(-12 32 78)"/>
      <ellipse cx="92" cy="76"  rx="2.5" ry="5.5" transform="rotate(-12 92 76)"/>
      <ellipse cx="34" cy="93"  rx="2.5" ry="5.5" transform="rotate(-12 34 93)"/>
      <ellipse cx="94" cy="91"  rx="2.5" ry="5.5" transform="rotate(-12 94 91)"/>
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
    <rect x="0" y="0" width="120" height="62" fill="#E1F5FE" rx="0"/>
    <rect x="0" y="62" width="120" height="58" fill="url(#wf)"/>
    <path d="M0,62 Q15,59 30,62 Q45,65 60,62 Q75,59 90,62 Q105,65 120,62"
          fill="#B3E5FC" stroke="none" opacity="0.6"/>
    <path d="M0,68 Q20,66 40,68 Q60,70 80,68 Q100,66 120,68"
          fill="none" stroke="#4FC3F7" stroke-width="1.5" opacity="0.45"/>
    <ellipse cx="60" cy="66" rx="28" ry="4" fill="rgba(255,255,255,0.22)"/>
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
    <rect x="0" y="0" width="120" height="70" fill="#E1F5FE"/>
    <path d="M0,70 Q15,58 30,70 Q45,82 60,70 Q75,58 90,70 Q105,82 120,70 L120,120 L0,120 Z"
          fill="url(#ws)"/>
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
    <rect x="0" y="0" width="120" height="72" fill="#E3F2FD"/>
    <path d="M0,72 Q20,38 40,72 Q60,106 80,72 Q100,38 120,72 L120,120 L0,120 Z"
          fill="url(#wm)"/>
    <path d="M0,68  Q10,56 20,62 Q28,68 38,58"
          fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.72"/>
    <path d="M80,68 Q90,56 100,62 Q108,68 118,58"
          fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.72"/>
    <g fill="white" opacity="0.7">
      <circle cx="37" cy="50" r="2.2"/><circle cx="43" cy="44" r="1.7"/><circle cx="30" cy="47" r="1.5"/>
    </g>
    <g fill="white" opacity="0.7">
      <circle cx="117" cy="50" r="2.2"/><circle cx="111" cy="44" r="1.7"/><circle cx="110" cy="51" r="1.5"/>
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
    <rect x="0" y="0" width="120" height="76" fill="#BBDEFB"/>
    <path d="M0,76 Q20,14 40,76 Q60,138 80,76 Q100,14 120,76 L120,120 L0,120 Z"
          fill="url(#wh)"/>
    <path d="M-4,70 Q18,8  40,70"
          fill="none" stroke="url(#whcrest)" stroke-width="6" stroke-linecap="round" opacity="0.75"/>
    <path d="M80,70 Q102,8 124,70"
          fill="none" stroke="url(#whcrest)" stroke-width="6" stroke-linecap="round" opacity="0.75"/>
    <path d="M20,32 Q30,20 42,28 Q52,36 40,42"
          fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" opacity="0.82"/>
    <path d="M80,32 Q90,20 102,28 Q112,36 100,42"
          fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" opacity="0.82"/>
    <g fill="white" opacity="0.8">
      <circle cx="38" cy="16" r="3"/><circle cx="45" cy="10" r="2.2"/>
      <circle cx="30" cy="13" r="2"/><circle cx="50" cy="18" r="1.8"/>
    </g>
    <g fill="white" opacity="0.8">
      <circle cx="98" cy="16" r="3"/><circle cx="105" cy="10" r="2.2"/>
      <circle cx="90" cy="13" r="2"/><circle cx="110" cy="18" r="1.8"/>
    </g>
  </svg>`;
}

// ─── Icon selector maps ────────────────────────────────────────────────────────
const WEATHER_ICONS = {
  'sunny': iconSunny, 'partly-cloudy': iconPartlyCloudy,
  'cloudy': iconCloudy, 'rainy': iconRainy, 'stormy': iconStormy
};
const WAVE_ICONS = {
  'flat': iconWaveFlat, 'small': iconWaveSmall,
  'medium': iconWaveMedium, 'high': iconWaveHigh
};

// ─── Leaflet maps + animation handles ────────────────────────────────────────
let leafletMaps = [null, null, null];  // one per time slot
let windAnimIds = [null, null, null];
let waveAnimIds = [null, null, null];

// ─── Wind speed → particle colour ─────────────────────────────────────────────
function windColour(kmh, alpha) {
  if (kmh <  10) return `rgba( 30,100,210,${alpha})`;   // calm   — dark blue
  if (kmh <  30) return `rgba(  0,160,100,${alpha})`;   // light  — teal
  if (kmh <  50) return `rgba(200,130,  0,${alpha})`;   // strong — amber
  return                 `rgba(210, 30, 30,${alpha})`;  // storm  — red
}

// Meteorological degrees → standard Hebrew abbreviated compass label
function windDirHebrew(deg) {
  const dirs = ["צפ'","צפ'-מז'","מז'","דר'-מז'","דר'","דר'-מע'","מע'","צפ'-מע'"];
  return dirs[Math.round(deg / 45) % 8];
}

// ─── Initialise Leaflet maps (once) ───────────────────────────────────────────
function initLeafletMaps() {
  [0,1,2].forEach(i => {
    if (leafletMaps[i]) return;
    leafletMaps[i] = L.map(`windMap${i}`, {
      center: [LAT, LON], zoom: 14,
      zoomControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false,
      keyboard: false,
      attributionControl: i === 2
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(leafletMaps[i]);
  });
}

// ─── Wind particle animation ───────────────────────────────────────────────────
function startWindAnimation(idx, speedKmh, dirDeg) {
  const canvas = document.getElementById(`windCanvas${idx}`);
  if (!canvas) return;
  if (windAnimIds[idx]) { cancelAnimationFrame(windAnimIds[idx]); windAnimIds[idx] = null; }

  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  canvas.width  = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');

  const travelDeg = (dirDeg + 180) % 360;
  const rad   = travelDeg * Math.PI / 180;
  const speed = Math.max(0.5, speedKmh * 0.038);
  const vx = Math.sin(rad) * speed;
  const vy = -Math.cos(rad) * speed;

  const N = 180, MAX_TRAIL = 14;

  function spawnPos(random) {
    if (random) return { x: Math.random()*W, y: Math.random()*H };
    if (Math.abs(vx) >= Math.abs(vy))
      return { x: vx > 0 ? 0 : W, y: Math.random()*H };
    return { x: Math.random()*W, y: vy > 0 ? 0 : H };
  }

  const particles = Array.from({ length: N }, () => {
    const p = spawnPos(true);
    return { x:p.x, y:p.y, history:[], age:Math.floor(Math.random()*80),
             life:55+Math.random()*65, spd:0.5+Math.random()*0.9 };
  });

  function frame() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.history.push({ x:p.x, y:p.y });
      if (p.history.length > MAX_TRAIL) p.history.shift();
      p.x += vx * p.spd;
      p.y += vy * p.spd;
      p.age++;
      const lifeFade = Math.sin((p.age / p.life) * Math.PI);
      for (let i = 1; i < p.history.length; i++) {
        const t = i / p.history.length;
        ctx.strokeStyle = windColour(speedKmh, t * lifeFade * 0.88);
        ctx.lineWidth   = 0.8 + t * 0.9;
        ctx.beginPath();
        ctx.moveTo(p.history[i-1].x, p.history[i-1].y);
        ctx.lineTo(p.history[i].x,   p.history[i].y);
        ctx.stroke();
      }
      if (p.age >= p.life || p.x < -20 || p.x > W+20 || p.y < -20 || p.y > H+20) {
        const np = spawnPos(false);
        p.x=np.x; p.y=np.y; p.history=[];
        p.age=0; p.life=55+Math.random()*65; p.spd=0.5+Math.random()*0.9;
      }
    });
    windAnimIds[idx] = requestAnimationFrame(frame);
  }
  frame();
}

// ─── Wave canvas animation (per cell) ─────────────────────────────────────────
function startWaveAnimation(idx, waveHeightM, waveDirDeg) {
  const canvas = document.getElementById(`waveCanvas${idx}`);
  if (!canvas) return;
  if (waveAnimIds[idx]) { cancelAnimationFrame(waveAnimIds[idx]); waveAnimIds[idx] = null; }

  const cell = canvas.parentElement;
  const rect = cell.getBoundingClientRect();
  canvas.width  = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');

  const amplitude  = Math.min(H * 0.38, Math.max(3, waveHeightM * 9));
  const numLayers  = 3;
  const dirRad     = (waveDirDeg ?? 270) * Math.PI / 180;
  const phaseSpeedX = Math.sin(dirRad) * 0.045;
  let phase = 0;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < numLayers; i++) {
      const layerOffset = (i / numLayers) * Math.PI * 2;
      const yBase   = H * (0.28 + i * 0.2);
      const opacity = 0.22 + (i / numLayers) * 0.5;
      const amp     = amplitude * (1 - i * 0.22);

      ctx.beginPath();
      ctx.moveTo(0, yBase);
      for (let x = 0; x <= W; x += 2) {
        const y = yBase + Math.sin((x/W)*Math.PI*3.5 + phase + layerOffset)*amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      const grad = ctx.createLinearGradient(0, yBase-amp, 0, H);
      grad.addColorStop(0, `rgba(41,182,246,${opacity})`);
      grad.addColorStop(1, `rgba(1,87,155,${opacity*0.45})`);
      ctx.fillStyle = grad;
      ctx.fill();

      // White crest line
      ctx.beginPath();
      ctx.moveTo(0, yBase);
      for (let x = 0; x <= W; x += 2) {
        ctx.lineTo(x, yBase + Math.sin((x/W)*Math.PI*3.5 + phase + layerOffset)*amp);
      }
      ctx.strokeStyle = `rgba(255,255,255,${opacity*0.55})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    phase += phaseSpeedX || 0.04;
    waveAnimIds[idx] = requestAnimationFrame(frame);
  }
  frame();
}

// ─── Time slots ────────────────────────────────────────────────────────────────
const TIME_SLOTS = [
  { key:'morning', label:'בוקר',   hour:8  },
  { key:'noon',    label:'צהריים', hour:13 },
  { key:'evening', label:'ערב',    hour:19 },
];

function getCurrentSlotKey() {
  const h = new Date().getHours();
  if (h < 11) return 'morning';
  if (h < 17) return 'noon';
  return 'evening';
}

function findHourIndex(timeArray, dateStr, hour) {
  const target = `${dateStr}T${String(hour).padStart(2,'0')}:00`;
  const idx = timeArray.findIndex(t => t === target);
  if (idx !== -1) return idx;
  return timeArray.findIndex(t => t.startsWith(dateStr));
}

// ─── Drum day picker ──────────────────────────────────────────────────────────
let drumScrollTimer = null;

function buildDrum(daily) {
  const track    = document.getElementById('drumTrack');
  track.innerHTML = '';

  // Leading spacer so the first real item can scroll to centre
  const s1 = document.createElement('div');
  s1.className = 'drum-spacer';
  track.appendChild(s1);

  // ── Yesterday (visual only, not selectable) ──────────────────────────────
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const ydItem = document.createElement('div');
  ydItem.className = 'drum-item drum-yesterday';
  ydItem.dataset.idx = '-1';
  ydItem.innerHTML = `
    <div class="drum-letter">${HEBREW_DAYS[yd.getDay()]}</div>
    <div class="drum-icon">—</div>
    <div class="drum-temp">—</div>
  `;
  track.appendChild(ydItem);

  const todayStr = new Date().toISOString().slice(0,10);

  (daily?.time ?? []).slice(0,7).forEach((dateStr, i) => {
    const date    = new Date(dateStr + 'T12:00:00');
    const dow     = date.getDay();
    const letter  = HEBREW_DAYS[dow];
    const isToday = dateStr === todayStr;
    const cat     = daily ? getWeatherCategory(daily.weathercode[i]) : 'cloudy';
    const emoji   = WEATHER_EMOJI[cat];
    const maxT    = daily ? Math.round(daily.temperature_2m_max[i]) : '--';

    const item = document.createElement('div');
    item.className = 'drum-item' + (isToday ? ' today' : '');
    item.dataset.idx = String(i);
    item.innerHTML = `
      <div class="drum-letter">${letter}</div>
      <div class="drum-icon">${emoji}</div>
      <div class="drum-temp">${maxT}°</div>
    `;
    item.addEventListener('click', () => scrollDrumTo(i));
    track.appendChild(item);
  });

  // Trailing spacer so day 6 can scroll to centre
  const s2 = document.createElement('div');
  s2.className = 'drum-spacer';
  track.appendChild(s2);

  // Scroll to selected day — +1 offset to skip past yesterday
  requestAnimationFrame(() => {
    const itemW = track.clientWidth / 3;
    track.scrollLeft = -(gSelectedDay + 1) * itemW;
    updateDrumActive(gSelectedDay);
  });

  // Detect snap-scroll end
  track.removeEventListener('scroll', onDrumScroll);
  track.addEventListener('scroll', onDrumScroll);
}

function onDrumScroll() {
  clearTimeout(drumScrollTimer);
  drumScrollTimer = setTimeout(() => {
    const track = document.getElementById('drumTrack');
    const itemW = track.clientWidth / 3;
    // -1 to subtract the yesterday slot at position 0
    const idx = Math.max(0, Math.min(6, Math.round(-track.scrollLeft / itemW) - 1));
    if (idx !== gSelectedDay) {
      gSelectedDay = idx;
      updateDrumActive(idx);
      if (gWeatherData) renderDay(idx);
    }
  }, 120);
}

function scrollDrumTo(idx) {
  const track = document.getElementById('drumTrack');
  const itemW = track.clientWidth / 3;
  // +1 to skip past the yesterday slot
  track.scrollTo({ left: -(idx + 1) * itemW, behavior:'smooth' });
}

// 3-D ring illusion: distance from centre drives scale, opacity and rotateY
function updateDrumActive(idx) {
  const RING = [
    { scale: 1.06, opacity: 1.00, ry:  0  },  // dist 0 — centre / closest
    { scale: 0.84, opacity: 0.62, ry: 34  },  // dist 1
    { scale: 0.66, opacity: 0.36, ry: 58  },  // dist 2
    { scale: 0.52, opacity: 0.18, ry: 72  },  // dist 3+
  ];
  document.querySelectorAll('.drum-item').forEach((el) => {
    const elIdx = parseInt(el.dataset.idx);
    const dist  = Math.abs(elIdx - idx);
    const r     = RING[Math.min(dist, RING.length - 1)];
    const sign  = elIdx >= idx ? -1 : 1;   // tilt direction
    el.classList.toggle('active', elIdx === idx);
    el.style.transform = `perspective(480px) rotateY(${sign * r.ry}deg) scale(${r.scale})`;
    el.style.opacity   = String(r.opacity);
  });
}

// ─── Render the 4-row matrix for a specific forecast day ──────────────────────
function renderDay(dayIdx) {
  gSelectedDay = dayIdx;
  updateDrumActive(dayIdx);

  const daily        = gWeatherData?.daily;
  const wHourly      = gWeatherData?.hourly;
  const marineHourly = gMarineData?.hourly;
  if (!daily || !wHourly || !marineHourly) return;

  const dateStr = daily.time[dayIdx];

  // ── Sun times ──
  const riseRaw = daily.sunrise?.[dayIdx] || '';
  const setRaw  = daily.sunset?.[dayIdx]  || '';
  document.getElementById('sunriseVal').textContent = riseRaw.slice(11,16) || '--:--';
  document.getElementById('sunsetVal').textContent  = setRaw.slice(11,16)  || '--:--';

  // ── Weather + Wave + Wind per time slot ──
  initLeafletMaps();

  TIME_SLOTS.forEach(({ hour }, i) => {
    // Weather
    const wIdx = findHourIndex(wHourly.time, dateStr, hour);
    const temp = wIdx !== -1 ? Math.round(wHourly.temperature_2m[wIdx]) : null;
    const code = wIdx !== -1 ? wHourly.weathercode[wIdx] : null;
    const wxCat = code != null ? getWeatherCategory(code) : 'cloudy';
    const wxCell = document.getElementById(`wx${i}`);
    wxCell.innerHTML = `
      <div class="wx-icon">${(WEATHER_ICONS[wxCat] || iconCloudy)()}</div>
      <div class="wx-temp">${temp != null ? temp+'°' : '--'}</div>
    `;

    // Waves + sea surface temperature
    const mIdx       = findHourIndex(marineHourly.time, dateStr, hour);
    const waveH      = mIdx !== -1 ? marineHourly.wave_height?.[mIdx] : null;
    const waveDir    = mIdx !== -1 ? (marineHourly.wave_direction?.[mIdx] ?? 270) : 270;
    const seaTemp    = mIdx !== -1 ? marineHourly.sea_surface_temperature?.[mIdx] : null;
    const wvValEl    = document.getElementById(`waveVal${i}`);
    wvValEl.textContent = waveH != null ? `${waveH.toFixed(1)} מ'` : '--';
    const seaTempEl  = document.getElementById(`seaTemp${i}`);
    if (seaTempEl) seaTempEl.textContent = seaTemp != null ? `🌡 ${Math.round(seaTemp)}°` : '--°';

    // Trigger wave canvas after a short delay so the cell has rendered dimensions
    setTimeout(() => startWaveAnimation(i, waveH ?? 0.5, waveDir), 50);

    // Wind
    const windSpeed  = wIdx !== -1 ? (wHourly.wind_speed_10m?.[wIdx]     ?? 0) : 0;
    const windDir    = wIdx !== -1 ? (wHourly.wind_direction_10m?.[wIdx] ?? 0) : 0;
    document.getElementById(`windBadge${i}`).textContent =
      `${windDirHebrew(windDir)} · ${Math.round(windSpeed)} קמ"ש`;
    setTimeout(() => startWindAnimation(i, windSpeed, windDir), 80);
  });
}

// ─── Show / hide loading overlay ──────────────────────────────────────────────
function setLoading(on) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !on);
}

// ─── Show / clear error banner ─────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('errorBanner');
  el.textContent = msg;
  el.classList.toggle('visible', !!msg);
}

// ─── Timestamp ────────────────────────────────────────────────────────────────
function updateTimestamp() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2,'0');
  const mm  = String(now.getMinutes()).padStart(2,'0');
  document.getElementById('lastUpdated').textContent = `עודכן לאחרונה: ${hh}:${mm}`;
}

// ─── Fetch both APIs ──────────────────────────────────────────────────────────
async function fetchAllData() {
  setLoading(true);
  showError('');
  try {
    const [weatherRes, marineRes] = await Promise.all([
      fetch(`/api/weather?lat=${LAT}&lon=${LON}`),
      fetch(`/api/marine?lat=${LAT}&lon=${LON}`)
    ]);
    if (!weatherRes.ok) throw new Error(`Weather ${weatherRes.status}`);
    if (!marineRes.ok)  throw new Error(`Marine ${marineRes.status}`);

    gWeatherData = await weatherRes.json();
    gMarineData  = await marineRes.json();

    buildDrum(gWeatherData.daily);
    renderDay(gSelectedDay);
    updateTimestamp();
  } catch (err) {
    console.error('Fetch error:', err);
    showError('שגיאה בטעינת הנתונים. בדוק חיבור לאינטרנט.');
  } finally {
    setLoading(false);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
buildDrum(null);          // show placeholder drum while loading
fetchAllData();           // fetch real data
setInterval(fetchAllData, REFRESH_MS);
