const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

app.get('/', (req, res) => {
  res.send('Api is up and running!');
})
app.get('/api/weather', async (req, res) => {
  console.log('Received request for weather');
  const city = req.query.city || 'Rome';
  const apiKey = process.env.WEATHER_API_KEY;
  const url = `http://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${city}`;

  try {
    const response = await axios.get(url);
    console.log('Weather API response received');
    res.json(response.data);
  } catch (err) {
    console.error('Error fetching weather data:', err.message);
    res.status(500).json({ error: 'Error fetching weather data' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
