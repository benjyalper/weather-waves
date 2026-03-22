# 🌊 Weather + Waves

A simple, colorful single-page web app that shows current weather and sea wave conditions using the free [Open-Meteo](https://open-meteo.com/) APIs.

- **No API key required**
- **No paid services**
- Weather data: temperature + condition icon
- Marine data: wave height + water temperature
- Hebrew day-of-week calendar with today highlighted
- Auto-refreshes every 30 minutes
- Fully responsive (mobile + desktop)

---

## Project Structure

```
weather-waves/
├── package.json        ← dependencies & start script
├── server.js           ← Express backend (proxies Open-Meteo APIs)
├── public/
│   ├── index.html      ← single-page HTML
│   ├── style.css       ← responsive styles
│   └── script.js       ← all frontend logic + inline SVG icons
├── .gitignore
└── README.md
```

---

## Run Locally

```bash
cd weather-waves
npm install
npm start
```

Then open http://localhost:3000

---

## Deploy to Railway via GitHub

### Step 1 — Create a GitHub repository

1. Go to https://github.com/new
2. Give your repo a name (e.g. `weather-waves`)
3. Set it to **Public** or **Private**
4. Click **Create repository**

### Step 2 — Push your code

In the `weather-waves` folder, run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/weather-waves.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

### Step 3 — Deploy on Railway

1. Go to https://railway.app and sign in (free account works)
2. Click **New Project → Deploy from GitHub repo**
3. Select your `weather-waves` repository
4. Railway will automatically detect Node.js and run:
   ```
   npm install
   npm start
   ```
5. Click **Deploy** and wait ~1 minute

### Step 4 — Access your live app

1. In Railway, go to your project → **Settings → Domains**
2. Click **Generate Domain** to get a free `.up.railway.app` URL
3. Open that URL in any browser — your app is live!

---

## Change Location

To show weather for a different city, edit the top of `public/script.js`:

```js
const LAT  = 32.08;        // ← change latitude
const LON  = 34.78;        // ← change longitude
const CITY = 'תל אביב';   // ← change city name
```

---

## APIs Used

| API | URL |
|-----|-----|
| Weather | `https://api.open-meteo.com/v1/forecast` |
| Marine  | `https://marine-api.open-meteo.com/v1/marine` |

Both are free and require no registration or API key.
