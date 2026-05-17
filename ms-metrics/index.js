const express = require('express');
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
  else console.log('✅ ms-metrics conectado a Neon');
});

// RF-13: Registrar métricas de un evento
app.post('/metrics', async (req, res) => {
  const {
    event_id,
    vehicles_notified,
    avg_reaction_time_seconds,
    semaphores_activated,
    distance_km
  } = req.body;

  if (!event_id) {
    return res.status(400).json({ error: 'Falta event_id' });
  }

  try {
    await pool.query(
      `INSERT INTO event_metrics 
        (event_id, vehicles_notified, avg_reaction_time_seconds, semaphores_activated, distance_km)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO UPDATE SET
        vehicles_notified = $2,
        avg_reaction_time_seconds = $3,
        semaphores_activated = $4,
        distance_km = $5`,
      [event_id, vehicles_notified || 0, avg_reaction_time_seconds || 0,
       semaphores_activated || 0, distance_km || 0]
    );

    console.log(`📊 Métricas guardadas en Neon [${event_id}]`);
    res.status(201).json({ status: 'saved', event_id });

  } catch (err) {
    console.error('Error DB:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// RF-13: Obtener métricas de un evento específico
app.get('/metrics/shift', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.severity_level, e.status,
              e.activated_at, e.deactivated_at,
              e.total_duration_seconds,
              m.vehicles_notified, m.semaphores_activated
       FROM emergency_events e
       LEFT JOIN event_metrics m ON e.id = m.event_id
       WHERE e.status = 'completed'
       ORDER BY e.activated_at DESC
       LIMIT 20`
    );

    const events = result.rows;
    const total = events.length;

    if (total === 0) {
      return res.json({
        total_events: 0,
        avg_duration_seconds: 0,
        avg_saved_seconds: 0,
        saving_percent: 0,
        events: []
      });
    }

    const avgDuration = Math.floor(
      events.reduce((sum, e) => sum + (e.total_duration_seconds || 0), 0) / total
    );

    // Estimado sin sistema: 30% más lento
    const avgWithout = Math.floor(avgDuration * 1.30);
    const avgSaved = avgWithout - avgDuration;
    const savingPercent = ((avgSaved / avgWithout) * 100).toFixed(1);

    res.json({
      total_events: total,
      avg_duration_seconds: avgDuration,
      avg_saved_seconds: avgSaved,
      saving_percent: parseFloat(savingPercent),
      events
    });

  } catch (err) {
    console.error('Error metrics/shift:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// RF-13: Obtener métricas de un evento específico por ID
app.get('/metrics/:event_id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, m.vehicles_notified, m.avg_reaction_time_seconds, 
              m.semaphores_activated, m.distance_km
       FROM emergency_events e
       LEFT JOIN event_metrics m ON e.id = m.event_id
       WHERE e.id = $1`,
      [req.params.event_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RF-14: Historial de todos los eventos
app.get('/events', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.ambulance_id, e.severity_level, e.status,
              e.activated_at, e.deactivated_at, e.total_duration_seconds,
              m.vehicles_notified, m.semaphores_activated, m.distance_km
       FROM emergency_events e
       LEFT JOIN event_metrics m ON e.id = m.event_id
       ORDER BY e.activated_at DESC`
    );

    res.json({
      total: result.rows.length,
      events: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RNF-10: Exportar métricas para análisis estadístico
app.get('/export', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id as event_id, e.ambulance_id, e.severity_level,
              e.total_duration_seconds,
              ROUND(e.total_duration_seconds::numeric / 60, 2) as duration_minutes,
              e.activated_at, e.deactivated_at,
              m.vehicles_notified, m.avg_reaction_time_seconds,
              m.semaphores_activated, m.distance_km
       FROM emergency_events e
       LEFT JOIN event_metrics m ON e.id = m.event_id
       WHERE e.status = 'completed'
       ORDER BY e.activated_at DESC`
    );

    if (result.rows.length === 0) {
      return res.json({ message: 'No hay eventos completados' });
    }

    const avgDuration = (
      result.rows.reduce((sum, e) => sum + (e.total_duration_seconds || 0), 0) /
      result.rows.length / 60
    ).toFixed(2);

    const totalVehicles = result.rows.reduce(
      (sum, e) => sum + (e.vehicles_notified || 0), 0
    );

    res.json({
      total_events: result.rows.length,
      average_duration_minutes: avgDuration,
      total_vehicles_notified: totalVehicles,
      events: result.rows
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ms-metrics', db: 'neon' });
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`📊 ms-metrics corriendo en puerto ${PORT}`);
});