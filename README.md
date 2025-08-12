# CS628 - Full Stack Web Development
## Team Anderson / Hao / Sridhar 

This project is the Team Project for City University Masters of Computer Science program. It was coded and completed by Jeffrey Anderson, Jack Hao, and Sai Shruthi Sridhar.

# WeatherVis – Setup & Usage (CS628 Team Project)

## 1) Requirements
- **Node.js 18+** (18 or 20 recommended)
- **npm / pnpm / yarn**
- A **WeatherAPI.com** API key (used by the server)

## 2) Project Layout
```
root
├─ client/   # Frontend: Vite + React + Tailwind
└─ server/   # Backend: Express proxy to WeatherAPI
```

## 3) Install Dependencies
```bash
# Backend
cd server
npm i

# Frontend
cd ../client
npm i
```

## 4) Environment Variables
Create these files:

### `server/.env`
```env
PORT=3001
WEATHERAPI_KEY=your_weatherapi_key_here
CORS_ORIGIN=http://localhost:5173
```

### `client/.env`
```env
VITE_API_BASE=http://localhost:3001
```

## 5) Run in Development
Open two terminals.

**Terminal A (server):**
```bash
cd server
npm run dev    # or npm start / node index.js
```

**Terminal B (client):**
```bash
cd client
npm run dev
```

- Frontend: http://localhost:5173  
- Backend:  http://localhost:3001

## 6) How to Use (Frontend)
- Open the app → click **Start** to use browser location.
- **Settings**: search a city; change units (you can also click the temperature to toggle °F/°C).
- **Future weather**: toggle **hours/days**.
- **Use My Location**: refresh using geolocation.

> If the backend fails, the UI falls back to demo data so you can still test the flow.

## 7) Backend API (for testing)
- By city:
  ```
  GET /api/weather?city=Seattle
  ```
- By lat/lon:
  ```
  GET /api/weather?lat=47.60&lon=-122.33
  ```
- Examples:
  ```bash
  curl "http://localhost:3001/api/weather?city=Rome"
  curl "http://localhost:3001/api/weather?lat=41.90&lon=12.50"
  ```

## 8) Build for Production
```bash
cd client
npm run build
npm run preview   # optional local preview
```
Serve `client/dist` with any static host (Nginx, S3, etc.) or mount it in the Express server via `express.static`.  
Run the backend with `npm start` (or PM2/Docker) and ensure `WEATHERAPI_KEY` is set.

## 9) Troubleshooting
- **CORS errors** → `CORS_ORIGIN` in `server/.env` must match your frontend URL.
- **401/403 or quota** → check your `WEATHERAPI_KEY` and account limits.
- **Port in use** → change `PORT` or Vite’s dev server port.
- **Location denied** → allow location in browser site settings or search a city in **Settings**.
