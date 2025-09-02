import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  Cog,
  MapPin,
  Thermometer,
  ChevronRight,
  ArrowLeft,
  BarChart3,
} from "lucide-react";

const CARD = "card";
const BTN = "btn";
const SUBBTN = "btn-soft";

/* Weather code → coarse bucket mapping (for icons / tips) */
const WMO = {
  clear: [0, 1],
  cloudy: [2, 3, 45, 48],
  rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82],
  snow: [71, 73, 75, 77, 85, 86],
};

/* Resolve a code into "clear" | "cloudy" | "rain" | "snow" */
function codeBucket(code) {
  if (WMO.clear.includes(code)) return "clear";
  if (WMO.cloudy.includes(code)) return "cloudy";
  if (WMO.rain.includes(code)) return "rain";
  if (WMO.snow.includes(code)) return "snow";
  return "cloudy";
}

function buildAdvicePrompt(place, wx) {
  const bucketName = codeBucket(wx.current.weather_code); // clear/cloudy/rain/snow

  const hours = (wx.hourly?.temperature_2m || [])
    .slice(0, 6)
    .map((t, i) => {
      const code = wx.hourly?.weather_code?.[i] ?? wx.current.weather_code;
      return `${Math.round(t)}C ${codeBucket(code)}`;
    })
    .join(", ");

  const days = (wx.daily?.temperature_2m_max || [])
    .slice(0, 3)
    .map((max, i) => {
      const min = wx.daily?.temperature_2m_min?.[i];
      const code = wx.daily?.weather_code?.[i] ?? wx.current.weather_code;
      return `${Math.round(min)}-${Math.round(max)}C ${codeBucket(code)}`;
    })
    .join("; ");

  return `
You are a concise weather coach.

Location: ${place.label}
Current: ${Math.round(wx.current.temperature_2m)}C, UV ${Math.round(
    wx.current.uv_index ?? 0
  )}, ${bucketName}.
Next 6h: ${hours}.
Next 3d: ${days}.

Task: Return ONE short, actionable sentence for what to wear or do today (<120 chars). No emojis, no preface.
`.trim();
}

async function streamChatTip(content, onToken) {
  const resp = await fetch(`${BACKEND}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ content }),
  });
  if (!resp.ok || !resp.body) throw new Error("chat request failed");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let tip = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      const m = line.match(/^data:\s*(.*)$/);
      if (!m) continue;
      const data = m[1];
      if (data === "[DONE]") continue;

      try {
        const j = JSON.parse(data);
        const piece = j?.response ?? "";
        tip += piece;
        onToken?.(piece);
      } catch {
        tip += data;
        onToken?.(data);
      }
    }
  }

  return tip.trim();
}

/* Pick an icon component by bucket; pass Tailwind size classes via className */
function IconFor(code, className = "w-16 h-16") {
  const b = codeBucket(code);
  if (b === "clear") return <Sun className={className} />;
  if (b === "rain") return <CloudRain className={className} />;
  if (b === "snow") return <CloudSnow className={className} />;
  return <Cloud className={className} />;
}

/* Map WeatherAPI condition text to our coarse buckets */
function textToCode(text) {
  const s = (text || "").toLowerCase();
  if (s.includes("snow") || s.includes("sleet") || s.includes("blizzard"))
    return 71;
  if (
    s.includes("rain") ||
    s.includes("drizzle") ||
    s.includes("shower") ||
    s.includes("thunder")
  )
    return 61;
  if (
    s.includes("cloud") ||
    s.includes("overcast") ||
    s.includes("mist") ||
    s.includes("fog")
  )
    return 3;
  return 1;
}

/* Temperature helpers */
function cToF(c) {
  return (c * 9) / 5 + 32;
}
function formatTemp(t, unit) {
  if (t == null || Number.isNaN(t)) return "--";
  return unit === "F" ? Math.round(cToF(t)) + "°F" : Math.round(t) + "°C";
}

/* Backend base */
const BACKEND = import.meta.env.VITE_API_BASE || "http://localhost:3001";

/**
 * Fetches weather from your backend adapter (which calls WeatherAPI.com).
 * Expected response shape (subset):
 * {
 *   location: { name, region, lat, lon },
 *   current: {
 *     temp_c, uv, condition:{ text }, humidity, wind_kph, pressure_mb,
 *     vis_km, dewpoint_c, feelslike_c
 *   },
 *   forecast: { forecastday: [{ hour:[{time, temp_c, uv, condition}], day:{ maxtemp_c, mintemp_c, uv, condition } }, ...] }
 * }
 */
async function fetchWeatherFromBackend({ city, lat, lon }) {
  const url = new URL(`${BACKEND}/api/weather`);
  if (city) url.searchParams.set("city", city);
  if (lat != null && lon != null) {
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
  }

  // DEBUG: uncomment while testing
  // console.debug("[fetch] url =", url.toString());

  const r = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error("backend");
  const j = await r.json();

  // DEBUG: inspect raw payload
  // console.log("[fetch] raw json", j);

  const current = {
    temperature_2m: j.current?.temp_c ?? null,
    uv_index: j.current?.uv ?? null,
    weather_code: textToCode(j.current?.condition?.text),
  };

  const currentExtras = {
    humidity: j.current?.humidity ?? null,
    wind_kph: j.current?.wind_kph ?? null,
    pressure_mb: j.current?.pressure_mb ?? null,
    vis_km: j.current?.vis_km ?? null,
    dewpoint_c: j.current?.dewpoint_c ?? null,
    feelslike_c: j.current?.feelslike_c ?? null,
  };

  const hrs = j.forecast?.forecastday?.[0]?.hour ?? [];
  const hourly = {
    time: hrs.map((h) => h.time),
    temperature_2m: hrs.map((h) => h.temp_c),
    weather_code: hrs.map((h) => textToCode(h.condition?.text)),
    uv_index: hrs.map((h) => h.uv ?? 0),
  };

  const days = j.forecast?.forecastday ?? [];
  const daily = {
    temperature_2m_max: days.map((d) => d.day?.maxtemp_c),
    temperature_2m_min: days.map((d) => d.day?.mintemp_c),
    uv_index_max: days.map((d) => d.day?.uv ?? 0),
    weather_code: days.map((d) => textToCode(d.day?.condition?.text)),
  };

  const label = [j.location?.name, j.location?.region]
    .filter(Boolean)
    .join(", ");
  const latLon = { lat: j.location?.lat ?? lat, lon: j.location?.lon ?? lon };

  return { current, currentExtras, hourly, daily, label, ...latLon, _raw: j };
}

/* Minute tick just to keep time-sensitive UI fresh */
function useNowTimer(ms = 60_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/* Count proportions of weather buckets for a small “history” widget */
function useForecastBuckets(hourly) {
  return useMemo(() => {
    if (!hourly?.weather_code) return null;
    const counts = { clear: 0, cloudy: 0, rain: 0, snow: 0 };
    hourly.weather_code.forEach((c) => {
      counts[codeBucket(c)]++;
    });
    const total = hourly.weather_code.length || 1;
    return Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, v / total])
    );
  }, [hourly]);
}

/* Simple rule-based “tips” generator – no ML, just heuristics */
function makeSuggestion({ tempC, uv, code }) {
  const b = codeBucket(code);
  const parts = [];
  if (uv >= 6)
    parts.push("High UV – wear sunscreen (SPF 30+), hat, and sunglasses.");
  else if (uv >= 3)
    parts.push("Moderate UV – consider sunscreen if outdoors long.");
  if (tempC <= -5) parts.push("Very cold – insulated coat, gloves, and a hat.");
  else if (tempC <= 5) parts.push("Chilly – wear a warm jacket and layers.");
  else if (tempC >= 30) parts.push("Hot – light clothing and stay hydrated.");
  if (b === "rain") parts.push("Carry a waterproof jacket or umbrella.");
  if (b === "snow") parts.push("Snowy – boots with traction recommended.");
  return parts.join(" ") || "Enjoy your day!";
}

export default function WeatherVisApp() {
  const [view, setView] = useState("welcome");
  const [unit, setUnit] = useState("F");
  const [place, setPlace] = useState({
    label: "Seattle",
    lat: 47.6062,
    lon: -122.3321,
  });
  const [wx, setWx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forecastMode, setForecastMode] = useState("hours");
  const [showForecast, setShowForecast] = useState(false);
  const [aiTip, setAiTip] = useState("");
  const [aiTipLoading, setAiTipLoading] = useState(false);

  useNowTimer(60_000);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!wx?.current || (!wx?.hourly && !wx?.daily)) {
        setAiTip("");
        return;
      }
      setAiTip("");
      setAiTipLoading(true);

      try {
        const prompt = buildAdvicePrompt(place, wx);
        await streamChatTip(prompt, (piece) => {
          if (!cancelled) setAiTip((prev) => (prev + piece).slice(0, 240));
        });
      } catch (e) {
        if (!cancelled) {
          const b = {
            tempC: wx.current.temperature_2m,
            uv: wx.current.uv_index,
            code: wx.current.weather_code,
          };
          setAiTip(makeSuggestion(b));
        }
      } finally {
        if (!cancelled) setAiTipLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [wx, place.label]);

  const INITIAL_PLACE = { label: "Seattle", lat: 47.6062, lon: -122.3321 };

  const resetToWelcome = React.useCallback(() => {
    setView("welcome");
    setUnit("F");
    setPlace(INITIAL_PLACE);
    setWx(null);
    setLoading(false);
    setError("");
    setForecastMode("hours");
    setShowForecast(false);
    setAiTip("");
    setAiTipLoading(false);
  }, []);

  const bucketRatios = useForecastBuckets(wx?.hourly);

  const current = useMemo(() => {
    if (!wx?.current) return null;
    return {
      tempC: wx.current.temperature_2m,
      uv: wx.current.uv_index,
      code: wx.current.weather_code,
    };
  }, [wx]);

  /* Core loader: accepts (lat, lon, label) or just (label) for city search */
  async function loadFor(lat, lon, label) {
    setLoading(true);
    setError("");
    try {
      const data = await fetchWeatherFromBackend({ city: label, lat, lon });

      const usedCoordsOnly = label == null && lat != null && lon != null;

      setWx({
        current: data.current,
        hourly: data.hourly,
        daily: data.daily,
        extras: data.currentExtras,
        raw: data._raw,
      });

      setPlace((prev) => ({
        label: usedCoordsOnly
          ? prev.label || "Current Location"
          : data.label || label || "Unknown",
        lat: data.lat ?? lat,
        lon: data.lon ?? lon,
      }));

      setView("weather");
    } catch (e) {
      console.error(e);
      setError("Failed to load from backend. Using demo data.");

      const demo = {
        current: { temperature_2m: 33, uv_index: 7, weather_code: 1 },
        hourly: {
          time: Array.from({ length: 24 }, (_, i) => i),
          temperature_2m: Array.from(
            { length: 24 },
            (_, i) => 28 + Math.sin((i / 24) * Math.PI * 2) * 5
          ),
          weather_code: Array.from({ length: 24 }, (_, i) =>
            i % 6 === 0 ? 80 : i % 3 === 0 ? 3 : 1
          ),
          uv_index: Array.from({ length: 24 }, (_, i) =>
            Math.max(0, 8 - Math.abs(i - 14))
          ),
        },
        daily: {
          temperature_2m_max: [34, 32, 30],
          temperature_2m_min: [22, 21, 20],
          uv_index_max: [8, 6, 5],
          weather_code: [1, 3, 61],
        },
      };
      setWx(demo);

      setPlace((prev) => ({ ...prev }));

      setView("weather");
    } finally {
      setLoading(false);
    }
  }

  const useMyLocationNow = React.useCallback(async () => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported by this browser.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 60_000,
        });
      });

      const { latitude, longitude } = pos.coords;
      await loadFor(latitude, longitude);
      setShowForecast(true);
    } catch (err) {
      console.error("[geo] failed", err);
      const code = err?.code;
      if (code === 1)
        setError("Location permission denied. Please allow location access.");
      else if (code === 2) setError("Location unavailable. Try again later.");
      else if (code === 3) setError("Location request timed out. Try again.");
      else setError("Unable to get your location.");
    } finally {
      setLoading(false);
    }
  }, [loadFor]);

  /* Geolocation → load current position, else fallback to default place */
  const onStart = () => {
    if (!navigator.geolocation) {
      // loadFor(place.lat, place.lon, place.label);
      loadFor(place.lat, place.lon, place.label).then(() =>
        setShowForecast(true)
      );
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // console.debug("[geo] coords", pos.coords);
        await loadFor(pos.coords.latitude, pos.coords.longitude);
        setShowForecast(true);
      },
      async () => {
        await loadFor(place.lat, place.lon, place.label);
        setShowForecast(true);
      },
      { timeout: 8000 }
    );
  };

  /* Free-text city search via backend */
  const handleSearchCity = async (q) => {
    if (!q?.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchWeatherFromBackend({ city: q.trim() });

      // console.debug("[search] result", data.label, data.lat, data.lon);

      setPlace({ label: data.label || q.trim(), lat: data.lat, lon: data.lon });
      setWx({
        current: data.current,
        hourly: data.hourly,
        daily: data.daily,
        extras: data.currentExtras,
        raw: data._raw,
      });
      setView("weather");
    } catch {
      setError("City not found.");
    } finally {
      setLoading(false);
    }
  };

  function RecentLogsTable() {
    const [rows, setRows] = React.useState(null);
    const [err, setErr] = React.useState("");

    React.useEffect(() => {
      let off = false;
      (async () => {
        try {
          setErr("");
          const r = await fetch(`${BACKEND}/api/admin/recent?limit=10`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = await r.json();
          if (!off) setRows(j.rows || []);
        } catch (e) {
          if (!off) setErr("Failed to load recent logs.");
        }
      })();
      return () => {
        off = true;
      };
    }, []);

    if (err) {
      return <div className="text-xs text-rose-600">{err}</div>;
    }
    if (!rows) {
      return <div className="text-sm text-gray-600">Loading…</div>;
    }
    if (rows.length === 0) {
      return <div className="text-sm text-gray-600">No logs yet.</div>;
    }

    return (
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-2 pr-3">Time</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Where</th>
              <th className="py-2">Info</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap">
                  {new Date(r.at).toLocaleString()}
                </td>
                <td className="py-2 pr-3">{r.type}</td>
                <td className="py-2 pr-3">{r.where || "-"}</td>
                <td className="py-2">{r.info || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const suggestion = current ? makeSuggestion(current) : "";

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-100 via-indigo-50 to-emerald-50 text-gray-900">
      <header className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/60 bg-white/40 border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap md:flex-nowrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 grid place-items-center rounded-xl bg-gray-900 text-white">
              <Sun className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-semibold leading-tight">WeatherVis</h1>
              <p className="text-xs text-gray-500 -mt-0.5">
                Team 3 · CS628 · CityU Seattle
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className={SUBBTN} onClick={() => setView("dashboard")}>
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </button>
            <button className={SUBBTN} onClick={() => setView("settings")}>
              <Cog className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-6 flex-1 overflow-hidden grid md:grid-cols-2 gap-6">
        <section className="min-w-0">
          <AnimatePresence mode="wait">
            {view === "welcome" && (
              <motion.div
                key="welcome"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`${CARD} w-full max-w-[34rem] sm:max-w-[38rem] md:max-w-none mx-auto`}
              >
                <h2 className="text-lg font-semibold">Welcome</h2>
                <p className="mt-1 text-sm text-gray-600">
                  This demo follows your wireframe flow. Click Start to request
                  your location and show the Weather view. You can also open the
                  optional Dashboard or Settings.
                </p>

                {/* Buttons wrap on small screens to avoid stretching the card */}
                <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-3">
                  <button className={BTN} onClick={onStart}>
                    <ChevronRight className="w-4 h-4" /> Start
                  </button>
                  <button
                    className={SUBBTN}
                    onClick={() => setView("dashboard")}
                  >
                    Dashboard
                  </button>
                  <button
                    className={SUBBTN}
                    onClick={() => setView("settings")}
                  >
                    Settings
                  </button>
                </div>

                {/* Long emails wrap to prevent overflow on narrow devices */}
                <div className="mt-6 text-xs text-gray-500 leading-relaxed break-words">
                  <p>
                    <span className="font-medium">Authors:</span> Jeffrey
                    Anderson; Sai Shruthi Sridhar; Jack Hao
                  </p>
                  <p>
                    <span className="font-medium">Emails:</span> <br />
                    andersonjeffrey@cityuniversity.edu;
                    sridharsaishruthi@cityuniversity.edu;
                    haoruojie@cityuniversity.edu
                  </p>
                  <p className="mt-2">
                    WeatherVis generates illustrations & advice. This page
                    implements the client-side experience with mockable data
                    sources.
                  </p>
                </div>
              </motion.div>
            )}

            {view === "settings" && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={CARD}
              >
                <div className="flex items-center gap-2 mb-3">
                  <button className={SUBBTN} onClick={() => setView("welcome")}>
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                  <h2 className="text-lg font-semibold">Settings</h2>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">Units</label>
                    <div className="flex gap-2">
                      <button
                        className={`${SUBBTN} ${
                          unit === "F" ? "ring-2 ring-gray-900" : ""
                        }`}
                        onClick={() => setUnit("F")}
                      >
                        Fahrenheit (°F)
                      </button>
                      <button
                        className={`${SUBBTN} ${
                          unit === "C" ? "ring-2 ring-gray-900" : ""
                        }`}
                        onClick={() => setUnit("C")}
                      >
                        Celsius (°C)
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Change Location
                    </label>
                    <CitySearch onSearch={handleSearchCity} />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <label className="block text-sm font-medium">
                      Tips Style
                    </label>
                    <p className="text-sm text-gray-600">
                      (Future work) Choose tone/verbosity for auto-generated
                      tips. This demo uses simple rule-based tips.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {view === "dashboard" && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={CARD}
              >
                <div className="flex items-center gap-2 mb-3">
                  <button className={SUBBTN} onClick={() => setView("welcome")}>
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                  <h2 className="text-lg font-semibold">Dashboard</h2>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-gradient-to-br from-amber-50 to-rose-50 border border-amber-200">
                    <p className="text-sm font-medium">
                      Historical Weather Rate*
                    </p>
                    <p className="text-xs text-gray-600">
                      * Using the last 24 hours (or demo data).
                    </p>
                    <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                      {["clear", "cloudy", "rain", "snow"].map((k) => (
                        <div key={k} className="p-3 rounded-lg bg-white border">
                          <div className="flex items-center justify-center mb-2">
                            {IconFor(
                              k === "clear"
                                ? 1
                                : k === "rain"
                                ? 61
                                : k === "snow"
                                ? 71
                                : 3,
                              "w-6 h-6"
                            )}
                          </div>
                          <div
                            className="text-xs uppercase tracking-wide text-gray-500"
                            style={{ fontSize: "0.2em" }}
                          >
                            {k}
                          </div>
                          <div className="text-base font-semibold">
                            {bucketRatios
                              ? Math.round(bucketRatios[k] * 100)
                              : "--"}
                            %
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-gradient-to-br from-sky-50 to-emerald-50 border border-sky-200">
                    <p className="text-sm font-medium">Current Location</p>
                    <div className="mt-1 text-2xl font-semibold flex items-center gap-2">
                      <MapPin className="w-5 h-5" />
                      {place.label}
                    </div>
                    <div className="mt-3 text-sm text-gray-600">
                      Lat {place.lat.toFixed(2)}, Lon {place.lon.toFixed(2)}
                    </div>
                    <div className="mt-4">
                      {wx?.current ? (
                        <div className="flex items-center gap-4">
                          {IconFor(wx.current.weather_code)}
                          <div>
                            <div className="text-3xl font-bold">
                              {formatTemp(wx.current.temperature_2m, unit)}
                            </div>
                            <div className="text-sm text-gray-600">
                              UV {Math.round(wx.current.uv_index ?? 0)}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-600">
                          No data yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-4 rounded-xl bg-white border">
                  <p className="text-sm font-medium mb-2">Recent API Logs</p>
                  <RecentLogsTable />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section className="h-full">
          <div className={`${CARD} relative overflow-hidden`}>
            <div className="text-sm text-gray-500">Illustration</div>

            {/* One row: fixed icon cell + flexible info cell */}
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-[160px_1fr] items-center gap-4">
              <div className="rounded-2xl border-2 border-dashed overflow-hidden grid place-items-center w-full sm:w-[160px] h-[140px] sm:h-[160px]">
                {current ? (
                  IconFor(current.code, "w-full h-full p-2")
                ) : (
                  <Sun className="w-full h-full p-2" />
                )}
              </div>
              <div className="rounded-2xl border-2 border-dashed p-4 min-h-[160px] flex flex-col justify-center">
                <div className="text-xs text-gray-500">information</div>
                <div className="flex items-baseline gap-2">
                  <Thermometer className="w-4 h-4" />
                  <div
                    className="text-4xl font-bold select-none cursor-pointer"
                    title="Click to change unit"
                    onClick={() => setUnit((u) => (u === "F" ? "C" : "F"))}
                  >
                    {current ? formatTemp(current.tempC, unit) : "--"}
                  </div>
                </div>
                <div className="text-2xl font-semibold mt-1">{place.label}</div>
                <div className="text-[11px] text-gray-500">
                  (click temperature to change unit)
                </div>
              </div>
            </div>

            {/* Tips */}
            <div className="mt-6">
              <div className="text-sm text-gray-500 mb-1">Suggestions</div>
              <div className="rounded-2xl border-2 border-dashed p-4">
                {loading ? (
                  <div className="text-sm text-gray-600">Loading...</div>
                ) : (
                  <p className="text-base leading-relaxed">
                    {aiTipLoading ? "Generating tip…" : aiTip || "—"}
                  </p>
                )}
                {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
              </div>
            </div>

            <TodayStats extras={wx?.extras} unit={unit} />

            {/* Forecast picker (hours/days) */}
            {showForecast && (
              <div className="mt-6">
                <div className="text-sm text-gray-500 mb-2 flex items-center justify-between">
                  <span>Future weather</span>
                  <button
                    className="text-xs underline"
                    onClick={() =>
                      setForecastMode((m) => (m === "hours" ? "days" : "hours"))
                    }
                  >
                    click to change range (
                    {forecastMode === "hours" ? "hours" : "days"})
                  </button>
                </div>
                <div className="rounded-2xl border-2 border-dashed p-3">
                  <ForecastCells
                    city={place.label}
                    lat={place.lat}
                    lon={place.lon}
                    mode={forecastMode}
                    unit={unit}
                  />
                </div>
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button
                className={BTN}
                onClick={useMyLocationNow}
                disabled={loading}
                aria-busy={loading}
              >
                <MapPin className="w-4 h-4" /> Use My Location
              </button>
              <button className={SUBBTN} onClick={resetToWelcome}>
                Back to Welcome
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/* Small input + button; call onSearch(query) */
function CitySearch({ onSearch }) {
  const [q, setQ] = useState("");
  return (
    <div className="flex w-full max-w-sm items-stretch gap-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search city (e.g., Seattle)"
        className="min-w-0 flex-1 rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900"
      />
      <button className={`${SUBBTN} shrink-0`} onClick={() => onSearch?.(q)}>
        Go
      </button>
    </div>
  );
}

/* Render 4 compact forecast cells for either hours or days */
function renderForecastCells(wx, unit, mode) {
  if (!wx)
    return Array.from({ length: 4 }, (_, i) => (
      <div key={i} className="p-3 rounded-xl border bg-white text-center">
        <div className="text-xl font-semibold">--</div>
        <div className="text-xs text-gray-500">--:--</div>
        <div className="mt-1 flex items-center justify-center">
          <Cloud className="w-6 h-6" />
        </div>
      </div>
    ));

  if (mode === "days" && wx.daily?.temperature_2m_max) {
    const cells = [0, 1, 2, 3].map((i) => {
      const t = wx.daily.temperature_2m_max[i];
      const code = wx.daily.weather_code?.[i] ?? 1;
      return (
        <div
          key={"d" + i}
          className="p-3 rounded-xl border bg-white text-center"
        >
          <div className="text-xl font-semibold">{formatTemp(t, unit)}</div>
          <div className="text-xs text-gray-500">Day {i + 1}</div>
          <div className="mt-1 flex items-center justify-center">
            {IconFor(code, "w-6 h-6")}
          </div>
        </div>
      );
    });
    return cells;
  }

  const arr = [];
  for (let i = 0; i < 4; i++) {
    const t = wx.hourly?.temperature_2m?.[i];
    const code = wx.hourly?.weather_code?.[i] ?? 1;
    arr.push(
      <div key={"h" + i} className="p-3 rounded-xl border bg-white text-center">
        <div className="text-xl font-semibold">{formatTemp(t, unit)}</div>
        <div className="text-xs text-gray-500">{formatHourLabel(wx, i)}</div>
        <div className="mt-1 flex items-center justify-center">
          {IconFor(code, "w-6 h-6")}
        </div>
      </div>
    );
  }
  return arr;
}

function ForecastCells({ city, lat, lon, mode, unit }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const textToCode = (text) => {
    const s = (text || "").toLowerCase();
    if (s.includes("snow") || s.includes("sleet") || s.includes("blizzard"))
      return 71;
    if (
      s.includes("rain") ||
      s.includes("drizzle") ||
      s.includes("shower") ||
      s.includes("thunder")
    )
      return 61;
    if (
      s.includes("cloud") ||
      s.includes("overcast") ||
      s.includes("mist") ||
      s.includes("fog")
    )
      return 3;
    return 1;
  };

  React.useEffect(() => {
    let off = false;
    (async () => {
      try {
        setLoading(true);
        const url = new URL(`${BACKEND}/api/forecast`);
        if (lat != null && lon != null) {
          url.searchParams.set("lat", String(lat));
          url.searchParams.set("lon", String(lon));
        } else {
          url.searchParams.set("city", city || "Rome");
        }
        url.searchParams.set("type", mode); // 'days' | 'hours'
        url.searchParams.set("n", "4");

        const r = await fetch(url.toString());
        const j = await r.json();

        if (off) return;

        if (mode === "days") {
          const d = j?.daily ?? [];
          setData({
            daily: {
              temperature_2m_max: d.map((x) => x?.maxtemp_c),
              weather_code: d.map((x) =>
                x?.condition_text
                  ? textToCode(x.condition_text)
                  : x?.condition_code ?? 1
              ),
              time: d.map((x) => x?.date),
            },
          });
        } else {
          const h = j?.hours ?? [];
          setData({
            hourly: {
              temperature_2m: h.map((x) => x?.temp_c),
              weather_code: h.map((x) =>
                x?.condition_text
                  ? textToCode(x.condition_text)
                  : x?.condition_code ?? 1
              ),
              time: h.map((x) => x?.time),
            },
          });
        }
      } catch {
        if (!off) setData(null);
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [city, lat, lon, mode]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {renderForecastCells(loading ? null : data, unit, mode)}
    </div>
  );
}

/* Format hour label from WeatherAPI's hour time string */
function formatHourLabel(wx, i) {
  const iso = wx?.hourly?.time?.[i];
  if (iso == null) return "--:--";
  const d = typeof iso === "string" ? new Date(iso) : new Date();
  const h = d.getHours();
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12}:00 ${ampm}`;
}

/* Today stats grid fed by currentExtras */
function TodayStats({ extras, unit }) {
  if (!extras) return null;
  const feels =
    unit === "F"
      ? Math.round((extras.feelslike_c * 9) / 5 + 32) + "°F"
      : Math.round(extras.feelslike_c) + "°C";
  const dew =
    unit === "F"
      ? Math.round((extras.dewpoint_c * 9) / 5 + 32) + "°F"
      : Math.round(extras.dewpoint_c) + "°C";

  const items = [
    {
      label: "Humidity",
      value: extras.humidity != null ? `${extras.humidity}%` : "--",
    },
    {
      label: "Wind",
      value:
        extras.wind_kph != null ? `${Math.round(extras.wind_kph)} kph` : "--",
    },
    {
      label: "Pressure",
      value:
        extras.pressure_mb != null
          ? `${Math.round(extras.pressure_mb)} mb`
          : "--",
    },
    {
      label: "Visibility",
      value: extras.vis_km != null ? `${Math.round(extras.vis_km)} km` : "--",
    },
    { label: "Feels like", value: extras.feelslike_c != null ? feels : "--" },
    { label: "Dew point", value: extras.dewpoint_c != null ? dew : "--" },
  ];

  return (
    <div className="mt-6 rounded-2xl border bg-white/70 p-4 shadow-sm">
      <div className="text-sm text-gray-500 mb-2">Today details</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((it) => (
          <div
            key={it.label}
            className="px-3 py-2 rounded-xl border border-gray-200/70 bg-white/80"
          >
            <div className="text-xs text-gray-500">{it.label}</div>
            <div className="text-base font-semibold">{it.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
