# CS628 – WeatherVis (Team Project)
**Team:** Jeffrey Anderson • Jack Hao • Sai Shruthi Sridhar  
**Course:** CS628 – Full Stack Web Development (City University of Seattle)

---

## Overview
WeatherVis is a Vite + React single-page app backed by an Express server. It fetches current conditions and forecasts from WeatherAPI.com, generates a **one-sentence AI suggestion** based on the weather (via a local LLM), and **persists all requests/responses** to MongoDB Atlas. A simple **Dashboard** shows real-time widgets plus a **Recent API Logs** table sourced from the database.

---

## Features
- **Current weather** with location search and browser geolocation.
- **Forecasts** in two modes:
  - **Hours**: next _N_ hours (rolling window from “now”).
  - **Days**: next _N_ days (up to WeatherAPI limits).
- **AI suggestion**: a concise, actionable, single sentence (e.g., what to wear or carry today) generated from the current conditions and short-term forecast. Delivered via **SSE streaming**.
- **Data persistence**: each call to weather/forecast/chat is logged to MongoDB with request metadata, latency, and a compact response snapshot.
- **Dashboard view**:
  - “Historical Weather Rate” mini-widget (from the last 24h of hourly data already in memory).
  - “Current Location” card with icon, temperature, and UV.
  - **Recent API Logs** table (reads from the DB via an admin endpoint).

---

## Architecture
- **Frontend:** Vite + React + Tailwind + Framer Motion, icons via lucide-react.
- **Backend:** Express server that:
  - Proxies to **WeatherAPI.com** for `/api/weather` and `/api/forecast`.
  - Streams AI text from a local **Ollama** model for `/api/chat`.
  - Writes structured logs to **MongoDB Atlas**.
  - Serves a compact admin endpoint for recent logs.
- **Database:** MongoDB Atlas, three collections:
  - `weather_logs`
  - `forecast_logs`
  - `chat_tips`

---

## Requirements
- Node.js 18+ (18 or 20 recommended) and a package manager (npm/pnpm/yarn).
- A **WeatherAPI.com** API key.
- A **MongoDB Atlas** cluster and connection string.
- **Ollama** running locally (default `http://localhost:11434`) with a small chat model available (default model name: `gemma3`, configurable).

---

## Run
Open two terminals.

**Terminal A (server):**
```bash
cd server
node index.js
```

**Terminal B (client):**
```bash
cd client
npm run dev
```

- Frontend: http://localhost:5173  
- Backend:  http://localhost:3001

---

## Project Layout
- `client/` — Vite + React app
- `server/` — Express API (weather/forecast/chat/admin) + DB writes

---

## Environment Variables
Configure the following (typical dev values shown as examples; adapt as needed):

**Server**
- `PORT` — server port (default: `3001`)
- `WEATHER_API_KEY` — your WeatherAPI.com key
- `ATLAS_URI` — MongoDB Atlas connection string
- `DB_NAME` — target database name (e.g., `hos08`)
- `CORS_ORIGIN` — allowed frontend origin (e.g., `http://localhost:5173`)
- `OLLAMA_URL` — Ollama base URL (default: `http://localhost:11434`)
- `OLLAMA_MODEL` — model name to use (default: `gemma3`)

**Client**
- `VITE_API_BASE` — backend base URL (e.g., `http://localhost:3001`)

---

## Running the App (Development)
1. Install server dependencies, then client dependencies.
2. Set the environment variables listed above (server and client).
3. Start the **server** first, then the **client**.
4. Open the client in your browser (Vite’s default dev URL).  
   The server will be reachable at your configured `PORT`.

---

## How to Use (Frontend)
- Click **Start** to attempt geolocation and open the Weather view.
- In **Settings**, search for a city or switch units (you can also click the temperature to toggle °F/°C).
- Toggle **Future weather** between **hours** and **days**.
- Click **Use My Location** to refresh using browser geolocation.
- **Suggestions** area shows the AI-generated one-liner. If AI is unavailable, a simple rule-based fallback is used.

---

## API Reference (Backend)
**All routes are relative to your server base URL.**

### 1) Current Weather
- **Endpoint:** `/api/weather`
- **Query:** `city` or `lat` + `lon`
- **Notes:** Returns WeatherAPI current conditions plus enough fields to drive the UI and local heuristics. Each successful call is logged to `weather_logs`.

### 2) Forecast
- **Endpoint:** `/api/forecast`
- **Query:**  
  - `type` — `hours` or `days`  
  - `n` — positive integer count (hours or days to return)  
  - `city` or `lat` + `lon`
- **Notes:**  
  - For `hours`, the server returns a rolling window from “now” across as many daily blocks as needed (WeatherAPI daily cap applies).  
  - For `days`, the server caps to WeatherAPI’s forecast limit.  
  - Each successful call is logged to `forecast_logs`.

### 3) AI Suggestion (Streaming)
- **Endpoint:** `/api/chat`
- **Method:** `POST`
- **Body:** JSON with a `content` string (the prompt the app generates from current + forecast).
- **Response:** **SSE stream** (`text/event-stream`) with multiple `data:` lines, followed by a final line containing `[DONE]`.
- **Notes:**  
  - The frontend concatenates streamed chunks to build a single sentence.  
  - The full response is saved to `chat_tips`. If Ollama isn’t running or errors occur, the frontend falls back to a rule-based sentence.

### 4) Recent Logs (Dashboard Admin)
- **Endpoint:** `/api/admin/recent`
- **Query:** `limit` (optional, default 10, max 50)
- **Returns:** A unified list of recent rows across `weather_logs`, `forecast_logs`, and `chat_tips` sorted by time, with fields like type, timestamp, where, and a brief info column.
- **Notes:** Intended for the internal Dashboard table. Lock down or remove in production.

---

## Database Layout (Atlas)
Each collection stores a compact, query-friendly snapshot:

- **`weather_logs`**
  - `createdAt` (ISO date)
  - `latency_ms`
  - `request` (city and/or coordinates)
  - `response` (WeatherAPI payload for current)

- **`forecast_logs`**
  - `createdAt` (ISO date)
  - `latency_ms`
  - `request` (type = `hours|days`, `n`, city/coords)
  - `response` (location metadata + sliced daily/hours array)

- **`chat_tips`**
  - `createdAt` (ISO date)
  - `latency_ms`
  - `request.content` (final prompt sent to the model)
  - `response` (the generated one-liner; trimmed for size)

> The Dashboard’s **Recent API Logs** reads a lightweight projection from these collections and displays it as a table.

---

## Privacy & Storage Notes
- Logs are stored for debugging/demo purposes. If you ship this beyond coursework, consider retention limits, redaction, and admin protection for `/api/admin/recent`.
