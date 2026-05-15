const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Conexión Neon PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
  if (err) console.error('❌ Error conectando a Neon:', err.message);
  else console.log('✅ ms-geolocation conectado a Neon');
});

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;

let ambulanceLocations = {};
let nearbyVehicles = {};
let activeRoutes = {};

// RF-05: Calcular ruta fija Punto A → Punto B con Mapbox
app.post('/route/calculate', async (req, res) => {
  const { event_id, origin, destination } = req.body;

  if (!event_id || !origin || !destination) {
    return res.status(400).json({ error: 'Faltan campos: event_id, origin, destination' });
  }

  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?steps=true&geometries=geojson&access_token=${MAPBOX_TOKEN}`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      return res.status(404).json({ error: 'No se encontró ruta' });
    }

    const route = data.routes[0];

    // RF-07: Extraer intersecciones
    const intersections = [];
    route.legs[0].steps.forEach((step, index) => {
      if (step.intersections && step.intersections.length > 0) {
        const intersection = step.intersections[0];
        intersections.push({
          index,
          lat: intersection.location[1],
          lng: intersection.location[0],
          instruction: step.maneuver.instruction,
          distance_from_start: step.distance,
          estimated_seconds: step.duration
        });
      }
    });

    activeRoutes[event_id] = {
      event_id, origin, destination,
      distance_meters: route.distance,
      duration_seconds: route.duration,
      geometry: route.geometry,
      intersections,
      calculated_at: new Date()
    };

    // Guardar intersecciones en Neon
    for (const intersection of intersections) {
      await pool.query(
        `INSERT INTO route_intersections (event_id, intersection_index, lat, lng, instruction, eta_seconds)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [event_id, intersection.index, intersection.lat, intersection.lng,
         intersection.instruction, Math.round(intersection.estimated_seconds)]
      ).catch(err => console.error('Error guardando intersección:', err.message));
    }

    console.log(`🗺️  Ruta calculada [${event_id}]: ${(route.distance/1000).toFixed(2)}km - ${Math.round(route.duration/60)} min - ${intersections.length} intersecciones`);

    res.json({
      event_id,
      distance_km: (route.distance / 1000).toFixed(2),
      duration_minutes: Math.round(route.duration / 60),
      intersections_count: intersections.length,
      intersections,
      geometry: route.geometry
    });

  } catch (error) {
    console.error('Error Mapbox:', error);
    res.status(500).json({ error: 'Error calculando ruta' });
  }
});

// RF-07: ETA a intersecciones
app.post('/route/eta', async (req, res) => {
  const { event_id, current_lat, current_lng } = req.body;

  if (!event_id || !current_lat || !current_lng) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const route = activeRoutes[event_id];
  if (!route) {
    return res.status(404).json({ error: 'No hay ruta activa para este evento' });
  }

  try {
    const fetch = (await import('node-fetch')).default;

    const etaPromises = route.intersections.slice(0, 5).map(async (intersection) => {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${current_lng},${current_lat};${intersection.lng},${intersection.lat}?access_token=${MAPBOX_TOKEN}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        return {
          intersection_index: intersection.index,
          lat: intersection.lat,
          lng: intersection.lng,
          instruction: intersection.instruction,
          eta_seconds: Math.round(data.routes[0].duration),
          eta_minutes: (data.routes[0].duration / 60).toFixed(1),
          distance_meters: Math.round(data.routes[0].distance)
        };
      }
      return null;
    });

    const etas = (await Promise.all(etaPromises)).filter(Boolean);
    console.log(`⏱️  ETA calculado para ${etas.length} intersecciones [${event_id}]`);

    res.json({
      event_id,
      current_position: { lat: current_lat, lng: current_lng },
      intersections_eta: etas
    });

  } catch (error) {
    console.error('Error ETA:', error);
    res.status(500).json({ error: 'Error calculando ETA' });
  }
});

// Obtener ruta activa
app.get('/route/:event_id', (req, res) => {
  const route = activeRoutes[req.params.event_id];
  if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.json(route);
});

// Servidor HTTP
const server = app.listen(process.env.PORT || 3002, () => {
  console.log(`🗺️  ms-geolocation corriendo en puerto ${process.env.PORT || 3002}`);
});

// WebSocket - RF-04: GPS en tiempo real
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('📡 Nueva conexión WebSocket');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const { event_id, lat, lng } = data;

      if (!event_id || !lat || !lng) {
        ws.send(JSON.stringify({ error: 'Faltan campos: event_id, lat, lng' }));
        return;
      }

      ambulanceLocations[event_id] = { lat, lng, timestamp: new Date() };
      console.log(`📍 GPS [${event_id}]: ${lat}, ${lng}`);

      // Guardar posición en Neon (RNF-05)
      await pool.query(
        'INSERT INTO ambulance_positions (event_id, lat, lng) VALUES ($1, $2, $3)',
        [event_id, lat, lng]
      ).catch(err => console.error('Error guardando GPS:', err.message));

      ws.send(JSON.stringify({
        status: 'ok',
        event_id, lat, lng,
        timestamp: ambulanceLocations[event_id].timestamp
      }));

    } catch (e) {
      ws.send(JSON.stringify({ error: 'Mensaje inválido' }));
    }
  });

  ws.on('close', () => console.log('📡 WebSocket cerrado'));
});

// RF-04: Última posición
app.get('/location/:event_id', (req, res) => {
  const location = ambulanceLocations[req.params.event_id];
  if (!location) return res.status(404).json({ error: 'No hay ubicación para este evento' });
  res.json({ event_id: req.params.event_id, ...location });
});

// RF-06: Registrar vehículo cercano
app.post('/nearby', (req, res) => {
  const { event_id, vehicle_id, lat, lng } = req.body;
  if (!event_id || !vehicle_id || !lat || !lng) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  if (!nearbyVehicles[event_id]) nearbyVehicles[event_id] = [];

  const index = nearbyVehicles[event_id].findIndex(v => v.vehicle_id === vehicle_id);
  const vehicleData = { vehicle_id, lat, lng, timestamp: new Date() };

  if (index >= 0) nearbyVehicles[event_id][index] = vehicleData;
  else nearbyVehicles[event_id].push(vehicleData);

  res.json({ status: 'ok', vehicles_count: nearbyVehicles[event_id].length });
});

// RF-06: Vehículos cercanos
app.get('/nearby/:event_id', (req, res) => {
  const vehicles = nearbyVehicles[req.params.event_id] || [];
  res.json({ event_id: req.params.event_id, vehicles, count: vehicles.length });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ms-geolocation', db: 'neon' });
});