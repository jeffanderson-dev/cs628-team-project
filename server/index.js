const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const { connectToMongo } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

function resolveQ(req) {
  const city = req.query.city;
  const lat = req.query.lat;
  const lon = req.query.lon;
  if (lat && lon) return `${lat},${lon}`;
  return city || 'Rome';
}

app.get('/', (req, res) => {
  res.send('Api is up and running!');
})
app.get('/api/weather', async (req, res) => {
  console.log('Received request for weather');
  const city = req.query.city || 'Rome';
  const apiKey = process.env.WEATHER_API_KEY;
  const q = resolveQ(req);
  const url = `http://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${city}`;

  const startedAt = Date.now();
  try {
    const { data } = await axios.get(url);
    res.json(data);

    try {
      const db = await connectToMongo();
      await db.collection('weather_logs').insertOne({
        createdAt: new Date(),
        latency_ms: Date.now() - startedAt,
        request: {
          city: req.query.city || null,
          lat: req.query.lat ? Number(req.query.lat) : null,
          lon: req.query.lon ? Number(req.query.lon) : null
        },
        response: data
      });
    } catch (e) {
      console.error('mongo insert weather failed:', e.message);
    }
  } catch (err) {
    console.error('Error fetching weather data:', err.message);
    res.status(500).json({ error: 'Error fetching weather data' });
  }
});

const WEATHER_API_BASE = 'http://api.weatherapi.com/v1';

app.get('/api/forecast', async (req, res) => {
  console.log('Received request for forecast');
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing WEATHER_API_KEY in environment' });
  }

  const city = req.query.city || 'Rome';
  const type = (req.query.type || 'days').toLowerCase(); // 'days' | 'hours'
  const nRaw = parseInt(req.query.n, 10);
  if (Number.isNaN(nRaw) || nRaw <= 0) {
    return res.status(400).json({ error: 'Query param "n" must be a positive integer' });
  }

  const q = resolveQ(req);
  const startedAt = Date.now();

  try {
    if (type === 'days') {
      const days = Math.min(nRaw, 14);
      const url = `${WEATHER_API_BASE}/forecast.json?key=${apiKey}&q=${encodeURIComponent(city)}&days=${days}&aqi=no&alerts=no`;

      const { data } = await axios.get(url);
      const { location, forecast } = data;

      const daily = (forecast?.forecastday || []).map(d => ({
        date: d.date,                       // yyyy-MM-dd
        date_epoch: d.date_epoch,           // unix
        maxtemp_c: d.day?.maxtemp_c,
        mintemp_c: d.day?.mintemp_c,
        avgtemp_c: d.day?.avgtemp_c,
        maxwind_kph: d.day?.maxwind_kph,
        totalprecip_mm: d.day?.totalprecip_mm,
        avghumidity: d.day?.avghumidity,
        condition_text: d.day?.condition?.text,
        condition_icon: d.day?.condition?.icon,
        condition_code: d.day?.condition?.code,
        uv: d.day?.uv,
        daily_will_it_rain: d.day?.daily_will_it_rain,
        daily_chance_of_rain: d.day?.daily_chance_of_rain,
        daily_will_it_snow: d.day?.daily_will_it_snow,
        daily_chance_of_snow: d.day?.daily_chance_of_snow,
        astro: d.astro ? {
          sunrise: d.astro.sunrise,
          sunset: d.astro.sunset,
          moonrise: d.astro.moonrise,
          moonset: d.astro.moonset,
          moon_phase: d.astro.moon_phase,
          moon_illumination: d.astro.moon_illumination
        } : undefined
      }));

      const payload = {
        request: { type: 'days', n: days, original_n: nRaw, capped: nRaw > days },
        location: { name: location?.name, region: location?.region, country: location?.country, tz_id: location?.tz_id, lat: location?.lat, lon: location?.lon },
        daily
      }

      try {
        const db = await connectToMongo();
        await db.collection('forecast_logs').insertOne({
          createdAt: new Date(),
          latency_ms: Date.now() - startedAt,
          request: {
            type: 'days',
            n: days,
            original_n: nRaw,
            city: req.query.city || null,
            lat: req.query.lat ? Number(req.query.lat) : null,
            lon: req.query.lon ? Number(req.query.lon) : null
          },
          response: payload
        });
      } catch (e) {
        console.error('mongo insert forecast(days) failed:', e.message);
      }

      return res.json(payload);
    }

    if (type === 'hours') {
      const hoursRequested = nRaw;
      const MAX_HOURS = 14 * 24; // 336
      const hours = Math.min(hoursRequested, MAX_HOURS);
      const daysNeeded = Math.max(1, Math.ceil(hours / 24));
      const url = `${WEATHER_API_BASE}/forecast.json?key=${apiKey}&q=${encodeURIComponent(city)}&days=${daysNeeded}&aqi=no&alerts=no`;

      const { data } = await axios.get(url);
      const { location, forecast } = data;

      const nowEpoch = Math.floor(Date.now() / 1000);
      const allHours = (forecast?.forecastday || [])
        .flatMap(d => d.hour || [])
        .filter(h => h.time_epoch >= nowEpoch);

      const sliced = allHours.slice(0, hours).map(h => ({
        time: h.time,                 // "yyyy-MM-dd HH:mm"
        time_epoch: h.time_epoch,     // unix
        temp_c: h.temp_c,
        temp_f: h.temp_f,
        feelslike_c: h.feelslike_c,
        wind_kph: h.wind_kph,
        wind_dir: h.wind_dir,
        precip_mm: h.precip_mm,
        humidity: h.humidity,
        cloud: h.cloud,
        is_day: h.is_day,             // 1/0
        condition_text: h.condition?.text,
        condition_icon: h.condition?.icon,
        condition_code: h.condition?.code,
        uv: h.uv,
        chance_of_rain: h.chance_of_rain,
        chance_of_snow: h.chance_of_snow,
      }));

      const payload = {
        request: { type: 'hours', n: hours, original_n: hoursRequested, capped: hoursRequested > hours },
        location: { name: location?.name, region: location?.region, country: location?.country, tz_id: location?.tz_id, lat: location?.lat, lon: location?.lon },
        hours: sliced
      }

      try {
        const db = await connectToMongo();
        await db.collection('forecast_logs').insertOne({
          createdAt: new Date(),
          latency_ms: Date.now() - startedAt,
          request: {
            type: 'hours',
            n: hours,
            original_n: hoursRequested,
            city: req.query.city || null,
            lat: req.query.lat ? Number(req.query.lat) : null,
            lon: req.query.lon ? Number(req.query.lon) : null
          },
          response: payload
        });
      } catch (e) {
        console.error('mongo insert forecast(hours) failed:', e.message);
      }

      return res.json(payload);
    }

    return res.status(400).json({ error: 'Query param "type" must be "days" or "hours"' });
  } catch (err) {
    console.error('Error fetching forecast:', err.message);
    return res.status(500).json({ error: 'Error fetching forecast' });
  }
});

app.post("/api/chat", async (req, res) => {
  const content = (req.body?.content ?? "").toString();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  if (!content) {
    res.write(`data: ${JSON.stringify({ error: "empty_prompt" })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  const startedAt = Date.now();
  let full = "";

  try {
    const axiosResponse = await axios({
      method: "post",
      url: "http://localhost:11434/api/generate",
      data: {
        model: process.env.OLLAMA_MODEL || "gemma3",
        prompt: content,
        stream: true,
      },
      responseType: "stream",
    });

    axiosResponse.data.on("data", (buf) => {
      for (const line of buf.toString().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const j = JSON.parse(trimmed);
          if (j.response) {
            full += j.response;
            res.write(`data: ${JSON.stringify({ response: j.response })}\n\n`);
          } if (j.done) {
            res.write("data: [DONE]\n\n");
            res.end();
          }
        } catch {
          full += trimmed;
          res.write(`data: ${JSON.stringify({ response: trimmed })}\n\n`);
        }
      }
    });

    axiosResponse.data.on("end", async () => {
      try {
        const db = await connectToMongo();
        await db.collection('chat_tips').insertOne({
          createdAt: new Date(),
          latency_ms: Date.now() - startedAt,
          request: { content },
          response: full.trim().slice(0, 2000)
        });
      } catch (e) {
        console.error('mongo insert chat failed:', e.message);
      }
      res.write("data: [DONE]\n\n"); res.end();
    });
    axiosResponse.data.on("error", (error) => {
      console.error("Ollama stream error:", error);
      res.write(`data: ${JSON.stringify({ error: "stream_error", message: error.message })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });

    req.on("close", () => {
      try { axiosResponse.data.destroy(); } catch { }
    });
  } catch (err) {
    console.error("Chat upstream error:", err);
    res.write(`data: ${JSON.stringify({ error: "upstream_error", message: err.message })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

(async () => {
  try {
    await connectToMongo();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (e) {
    console.error('Failed to start server due to Mongo error:', e);
    process.exit(1);
  }
})();


app.get('/api/admin/recent', async (req, res) => {
  try {
    const db = await connectToMongo();
    const limit = Math.min(Number(req.query.limit) || 10, 50); 

    const [weather, forecast, chat] = await Promise.all([
      db.collection('weather_logs')
        .find({}, {
          projection: {
            createdAt: 1,
            'request.city': 1, 'request.lat': 1, 'request.lon': 1,
            'response.location.name': 1,
            'response.current.temp_c': 1
          }
        })
        .sort({ createdAt: -1 }).limit(limit).toArray(),

      db.collection('forecast_logs')
        .find({}, {
          projection: {
            createdAt: 1,
            'request.type': 1, 'request.n': 1, 'request.city': 1, 'request.lat': 1, 'request.lon': 1,
            'response.location.name': 1,
            'response.daily': { $slice: 1 }, 
            'response.hours': { $slice: 1 }
          }
        })
        .sort({ createdAt: -1 }).limit(limit).toArray(),

      db.collection('chat_tips')
        .find({}, {
          projection: {
            createdAt: 1,
            'request.content': 1,
            response: 1
          }
        })
        .sort({ createdAt: -1 }).limit(limit).toArray()
    ]);

    const rows = [
      ...weather.map(w => ({
        type: 'weather',
        at: w.createdAt,
        where: w.request?.city || (w.request?.lat != null && w.request?.lon != null
          ? `${w.request.lat},${w.request.lon}` : (w.response?.location?.name || '-')),
        info: (w.response?.current?.temp_c != null) ? `${Math.round(w.response.current.temp_c)}°C` : '-'
      })),
      ...forecast.map(f => ({
        type: `forecast/${f.request?.type || '-'}`,
        at: f.createdAt,
        where: f.request?.city || (f.request?.lat != null && f.request?.lon != null
          ? `${f.request.lat},${f.request.lon}` : (f.response?.location?.name || '-')),
        info: f.request?.type === 'days'
          ? `days=${f.request?.n ?? '-'}`
          : f.request?.type === 'hours'
            ? `hours=${f.request?.n ?? '-'}`
            : '-'
      })),
      ...chat.map(c => ({
        type: 'chat',
        at: c.createdAt,
        where: '-', 
        info: (c.response || '').slice(0, 80)
      }))
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    res.json({ rows });
  } catch (e) {
    console.error('recent logs error:', e);
    res.status(500).json({ error: 'recent_logs_failed' });
  }
});