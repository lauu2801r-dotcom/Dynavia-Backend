const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
  if (err) console.error('❌ Error conectando a Neon:', err.message);
  else console.log('✅ ms-emergency conectado a Neon');
});

const TRAFFIC_URL = process.env.TRAFFIC_URL || 'http://ms-traffic:3005';
const NOTIFICATIONS_URL = process.env.NOTIFICATIONS_URL || 'http://ms-notifications:3003';
const METRICS_URL = process.env.METRICS_URL || 'http://ms-metrics:3004';

function getSemaphoresForRoute(level) {
  if (level === 3) return [];
  return [
    { semaphore_id: 'SEM-001', location: { lat: 4.6951, lng: -74.0345 } },
    { semaphore_id: 'SEM-002', location: { lat: 4.6920, lng: -74.0400 } },
    { semaphore_id: 'SEM-003', location: { lat: 4.6900, lng: -74.0450 } },
  ];
}

// RF-01, RF-02: Activar emergencia
app.post('/emergency/activate', async (req, res) => {
  const { ambulance_id, level, severity_level, punto_b, punto_a_lat, punto_a_lng, punto_b_lat, punto_b_lng } = req.body;
  const finalLevel = Number(severity_level || level);

  if (!ambulance_id || !finalLevel) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  if (![1, 2, 3].includes(finalLevel)) {
    return res.status(400).json({ error: 'Nivel debe ser 1, 2 o 3' });
  }

  const event_id = `EVT-${Date.now()}`;
  const activated_at = new Date();

  // Activar semáforos
  const semaphores = getSemaphoresForRoute(finalLevel);
  let semaphores_activated = 0;
  if (semaphores.length > 0) {
    try {
      const trafficRes = await fetch(`${TRAFFIC_URL}/semaphore/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id, semaphores, level: finalLevel })
      });
      const trafficData = await trafficRes.json();
      semaphores_activated = trafficData.semaphores_activated || semaphores.length;
      console.log(`🚦 ${semaphores_activated} semáforos activados vía MQTT`);
    } catch (e) {
      semaphores_activated = semaphores.length;
      console.warn('⚠️ ms-traffic no respondió:', e.message);
    }
  }

  // Enviar notificaciones
  let vehicles_notified = 0;
  try {
    const notifRes = await fetch(`${NOTIFICATIONS_URL}/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id, level: finalLevel, ambulance_id })
    });
    const notifData = await notifRes.json();
    vehicles_notified = notifData.total_notified || 0;
    console.log(`📢 ${vehicles_notified} vehículos notificados`);
  } catch (e) {
    console.warn('⚠️ ms-notifications no respondió:', e.message);
  }

  try {
    await pool.query(
      `INSERT INTO emergency_events 
        (id, ambulance_id, severity_level, status, activated_at, 
         punto_a_lat, punto_a_lng, punto_b_lat, punto_b_lng,
         semaphores_activated, vehicles_notified)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10)`,
      [event_id, ambulance_id, finalLevel, activated_at,
       punto_a_lat || 4.6951, punto_a_lng || -74.0345,
       punto_b_lat || 4.6900, punto_b_lng || -74.0567,
       semaphores_activated, vehicles_notified]
    );

    console.log(`🚨 Emergencia activada: ${event_id} - Nivel ${finalLevel} - ${semaphores_activated} semáforos - ${vehicles_notified} vehículos`);

    res.status(201).json({
      message: 'Modo emergencia activado',
      event_id,
      activated_at,
      level: finalLevel,
      semaphores_activated,
      vehicles_notified
    });

  } catch (err) {
    console.error('Error BD activate:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// RF-03, RF-12: Desactivar emergencia
app.post('/emergency/deactivate', async (req, res) => {
  const { event_id } = req.body;
  if (!event_id) return res.status(400).json({ error: 'Falta event_id' });

  try {
    const found = await pool.query(
      `SELECT * FROM emergency_events WHERE id = $1`, [event_id]
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'Evento no encontrado en BD' });
    }

    const event = found.rows[0];
    const deactivated_at = new Date();
    const total_duration_seconds = Math.floor(
      (deactivated_at - new Date(event.activated_at)) / 1000
    );

    // Calcular distancia aproximada entre punto A y punto B
    const lat1 = parseFloat(event.punto_a_lat), lng1 = parseFloat(event.punto_a_lng);
    const lat2 = parseFloat(event.punto_b_lat), lng2 = parseFloat(event.punto_b_lng);
    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLng = (lng2-lng1) * Math.PI/180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
              Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
              Math.sin(dLng/2)*Math.sin(dLng/2);
    const distance_km = parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(2));

    await pool.query(
      `UPDATE emergency_events 
       SET status = 'completed', deactivated_at = $1, 
           total_duration_seconds = $2, distance_km = $3
       WHERE id = $4`,
      [deactivated_at, total_duration_seconds, distance_km, event_id]
    );

    // Restaurar semáforos
    try {
      await fetch(`${TRAFFIC_URL}/semaphore/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id })
      });
      console.log(`🚦 Semáforos restaurados para ${event_id}`);
    } catch (e) {
      console.warn('⚠️ ms-traffic restore no respondió:', e.message);
    }

    // Guardar métricas
    try {
      await fetch(`${METRICS_URL}/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id,
          vehicles_notified: event.vehicles_notified || 0,
          avg_reaction_time_seconds: total_duration_seconds,
          semaphores_activated: event.semaphores_activated || 0,
          distance_km
        })
      });
      console.log(`📊 Métricas registradas para ${event_id}`);
    } catch (e) {
      console.warn('⚠️ ms-metrics no respondió:', e.message);
    }

    console.log(`✅ Emergencia cerrada: ${event_id} - ${total_duration_seconds}s - ${distance_km}km`);

    res.json({
      message: 'Emergencia desactivada',
      event_id,
      activated_at: event.activated_at,
      deactivated_at,
      total_duration_seconds,
      duration_minutes: (total_duration_seconds / 60).toFixed(2),
      distance_km,
      semaphores_activated: event.semaphores_activated || 0,
      vehicles_notified: event.vehicles_notified || 0
    });

  } catch (err) {
    console.error('Error BD deactivate:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/emergency/:event_id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM emergency_events WHERE id = $1`, [req.params.event_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/emergency', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM emergency_events ORDER BY activated_at DESC LIMIT 20`
    );
    res.json({ events: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ms-emergency', db: 'neon' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 ms-emergency corriendo en puerto ${PORT}`);
});
