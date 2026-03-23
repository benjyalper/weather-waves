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

// ─── Find the hourly index for noon (12:00) on a given date string ────────────
// Used to pick a representative wave reading for a forecast day
function findNoonIndex(timeArray, dateStr) {
  const noonStr = dateStr + 'T12:00';
  let idx = timeArray.findIndex(t => t.startsWith(noonStr));
  if (idx !== -1) return idx;
  // Fallback: first entry for that day
  return timeArray.findIndex(t => t.startsWith(dateStr));
}

// ─── Find the index of the current hour in an hourly time array ───────────────
// Marine API returns arrays like ["2024-01-01T00:00", "2024-01-01T01:00", ...]
function findCurrentHourIndex(timeArray) {
  const nowPrefix = new Date().toISOString().slice(0, 13); // "2024-01-15T14"
  let idx = timeArray.findIndex(t => t.startsWith(nowPrefix));
  if (idx !== -1) return idx;

  // Fallback: find the closest time to now
  const nowMs = Date.now();
  let bestIdx = 0;
  let minDiff = Infinity;
  timeArray.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - nowMs);
    if (diff < minDiff) { minDiff = diff; bestIdx = i; }
  });
  return bestIdx;
}

// ─── Hebrew full day names (for the "viewing" label) ─────────────────────────
const HEBREW_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// ─── Render both cards for a specific forecast day index ─────────────────────
// dayIdx = 0 → today (uses current readings), dayIdx > 0 → future days (noon)
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

  // ── Weather card ──
  const daily = gWeatherData?.daily;
  if (daily) {
    const code     = daily.weathercode[dayIdx];
    const category = getWeatherCategory(code);
    const temp     = dayIdx === 0
      ? Math.round(gWeatherData.current.temperature_2m)   // live current temp
      : Math.round(daily.temperature_2m_max[dayIdx]);      // forecast max temp

    document.getElementById('weatherIcon').innerHTML     = WEATHER_ICONS[category]();
    document.getElementById('weatherTemp').textContent   = `${temp}°C`;
    document.getElementById('weatherLabel').textContent  = WEATHER_LABELS[category];
  }

  // ── Waves card ──
  const hourly = gMarineData?.hourly;
  if (hourly && daily) {
    const dateStr    = daily.time[dayIdx];
    const idx        = dayIdx === 0
      ? findCurrentHourIndex(hourly.time)   // live current hour
      : findNoonIndex(hourly.time, dateStr); // noon reading for that day
    const waveHeight = idx !== -1 ? hourly.wave_height?.[idx]              : null;
    const waterTemp  = idx !== -1 ? hourly.sea_surface_temperature?.[idx]  : null;

    if (waveHeight != null) {
      const cat = getWaveCategory(waveHeight);
      document.getElementById('waveIcon').innerHTML    = WAVE_ICONS[cat]();
      document.getElementById('waveHeight').textContent = `${waveHeight.toFixed(1)} m`;
      document.getElementById('waveLabel').textContent  = WAVE_LABELS[cat];
    } else {
      document.getElementById('waveHeight').textContent = '--';
      document.getElementById('waveLabel').textContent  = '--';
      document.getElementById('waveIcon').innerHTML     = iconWaveFlat();
    }

    document.getElementById('waterTemp').textContent = waterTemp != null
      ? `🌡 טמפרטורת המים: ${Math.round(waterTemp)}°C`
      : '🌡 טמפרטורת המים: --';
  }
}

// ─── Build the forecast calendar in the header ───────────────────────────────
// Always renders all 7 day-of-week cells in fixed order (א=Sun … ש=Sat).
// Because the page is dir="rtl", flexbox places the first DOM child on the
// RIGHT → א ends up on the right, ש on the left, exactly as in Hebrew.
// Past days (before today) are shown greyed-out and non-clickable.
function buildCalendar(daily) {
  const container  = document.getElementById('calendar');
  container.innerHTML = '';
  const todayDow   = new Date().getDay(); // 0=Sun … 6=Sat

  HEBREW_DAYS.forEach((letter, dow) => {
    // How many days away from today is this day-of-week slot?
    // negative = already passed this week, 0 = today, positive = upcoming
    const offset  = dow - todayDow;
    // Index into daily.time[] — only valid when offset is 0…6
    const apiIdx  = (offset >= 0 && daily && offset < daily.time.length)
                    ? offset : -1;
    const isToday = offset === 0;
    const isPast  = offset < 0;

    const cell = document.createElement('div');
    const classes = ['day-cell'];
    if (isToday)                          classes.push('today');
    if (isPast)                           classes.push('past');
    if (apiIdx === gSelectedDay && !isPast) classes.push('active');
    cell.className = classes.join(' ');
    cell.title = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][dow];

    if (daily && apiIdx !== -1) {
      // Has forecast data → show emoji + max temp
      const category = getWeatherCategory(daily.weathercode[apiIdx]);
      const emoji    = WEATHER_EMOJI[category];
      const maxTemp  = Math.round(daily.temperature_2m_max[apiIdx]);
      cell.style.cursor = 'pointer';
      cell.innerHTML = `
        <span class="day-letter">${letter}</span>
        <span class="day-icon">${emoji}</span>
        <span class="day-temp">${maxTemp}°</span>
      `;
      cell.addEventListener('click', () => renderDay(apiIdx));
    } else {
      // Past day or no data yet → letter only, not clickable
      cell.innerHTML = `<span class="day-letter">${letter}</span>`;
    }

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

// ─── Update the Weather card ──────────────────────────────────────────────────
function renderWeather(data) {
  const temp = data.current?.temperature_2m;
  const code = data.current?.weathercode;

  if (temp == null || code == null) {
    showError('לא ניתן לקרוא נתוני מזג אוויר');
    return;
  }

  const category = getWeatherCategory(code);

  document.getElementById('weatherIcon').innerHTML  = WEATHER_ICONS[category]();
  document.getElementById('weatherTemp').textContent = `${Math.round(temp)}°C`;
  document.getElementById('weatherLabel').textContent = WEATHER_LABELS[category];
}

// ─── Update the Waves card ────────────────────────────────────────────────────
function renderMarine(data) {
  const hourly = data.hourly;
  if (!hourly) {
    showError('לא ניתן לקרוא נתוני ים');
    return;
  }

  const idx         = findCurrentHourIndex(hourly.time);
  const waveHeight  = hourly.wave_height?.[idx];
  const waterTemp   = hourly.sea_surface_temperature?.[idx];

  if (waveHeight == null) {
    document.getElementById('waveHeight').textContent  = '--';
    document.getElementById('waveLabel').textContent   = '--';
    document.getElementById('waveIcon').innerHTML      = iconWaveFlat();
  } else {
    const category = getWaveCategory(waveHeight);
    document.getElementById('waveIcon').innerHTML      = WAVE_ICONS[category]();
    document.getElementById('waveHeight').textContent  = `${waveHeight.toFixed(1)} m`;
    document.getElementById('waveLabel').textContent   = WAVE_LABELS[category];
  }

  // Water temperature (may be missing in some regions)
  const waterTempEl = document.getElementById('waterTemp');
  if (waterTemp != null) {
    waterTempEl.textContent = `🌡 טמפרטורת המים: ${Math.round(waterTemp)}°C`;
  } else {
    waterTempEl.textContent = '🌡 טמפרטורת המים: --';
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
