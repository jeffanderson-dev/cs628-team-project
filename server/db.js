// db.js 
const { MongoClient } = require('mongodb');

const uri = process.env.ATLAS_URI; 
if (!uri) throw new Error('Missing ATLAS_URI in environment');

const DB_NAME = process.env.MONGO_DB_NAME || 'hos08';

const client = new MongoClient(uri, { maxPoolSize: 10 });

let dbCached = null;

async function connectToMongo() {
  if (dbCached) return dbCached;
  await client.connect();
  const db = client.db(DB_NAME);

  const ttlSeconds = (process.env.LOG_TTL_DAYS ? Number(process.env.LOG_TTL_DAYS) : 30) * 24 * 3600;

  await Promise.all([
    db.collection('weather_logs').createIndex({ createdAt: 1 }, { expireAfterSeconds: ttlSeconds }),
    db.collection('weather_logs').createIndex({ 'request.city': 1, createdAt: -1 }),
    db.collection('weather_logs').createIndex({ 'request.lat': 1, 'request.lon': 1, createdAt: -1 }),

    db.collection('forecast_logs').createIndex({ createdAt: 1 }, { expireAfterSeconds: ttlSeconds }),
    db.collection('forecast_logs').createIndex({ 'request.city': 1, createdAt: -1 }),
    db.collection('forecast_logs').createIndex({ 'request.lat': 1, 'request.lon': 1, createdAt: -1 }),

    db.collection('chat_tips').createIndex({ createdAt: 1 }, { expireAfterSeconds: ttlSeconds }),
    db.collection('chat_tips').createIndex({ 'request.place': 1, createdAt: -1 })
  ]);

  dbCached = db;
  return dbCached;
}

module.exports = { connectToMongo, client };
