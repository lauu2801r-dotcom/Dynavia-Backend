const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Conexión real a NeonDB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
  if (err) console.error('❌ Error conectando a Neon:', err.message);
  else console.log('✅ ms-emergency conectado a Neon');
});

// RF-01, RF-02: Activar emergencia → guarda en BD
app.post('/emergency/activate', async (req, res) => {
  const { ambulance_id, level, severity_level, punto_b, punto_a_lat, punto_a_lng, punto_b_lat, punto_b_lng } = req.body;

  const finalLevel = severity_level || level;

  if (!ambulance_id || !finalLevel) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  if (![1, 2, 3].includes(Number(finalLevel))) {
    return res.status(400).json({ error: 'Nivel debe ser 1, 2 o 3' });
  }

  const event_id = `EVT-${Date.now()}`;
  const activated_at = new Date();

  try {
    await pool.query(
      `INSERT INTO emergency_events 
        (id, ambulance_id, severity_level, status, activated_at, punto_a_lat, punto_a_lng, punto_b_lat, punto_b_lng)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8)`,
      [
        event_id,
        ambulance_id,
        Number(finalLevel),
        activated_at,
        punto_a_lat || 4.6951,
        punto_a_lng || -74.0345,
        punto_b_lat || 4.6900,
        punto_b_lng || -74.0567
      ]
    );

    console.log(`🚨 Emergencia activada y guardada en BD: ${event_id} - Nivel ${finalLevel}`);

    res.status(201).json({
      message: 'Modo emergencia activado',
      event_id,
      activated_at,
      level: Number(finalLevel)
    });

  } catch (err) {
    console.error('Error BD activate:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// RF-03, RF-12: Desactivar emergencia → calcula duración y guarda en BD
app.post('/emergency/deactivate', async (req, res) => {
  const { event_id } = req.body;

  if (!event_id) {
    return res.status(400).json({ error: 'Falta event_id' });
  }

  try {
    // Buscar el evento en BD
    const found = await pool.query(
      `SELECT * FROM emergency_events WHERE id = $1`,
      [event_id]
    );

    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'Evento no encontrado en BD' });
    }

    const event = found.rows[0];
    const deactivated_at = new Date();
    const activated_at = new Date(event.activated_at);
    const total_duration_seconds = Math.floor(
      (deactivated_at - activated_at) / 1000
    );

    // Actualizar en BD
    await pool.query(
      `UPDATE emergency_events 
       SET status = 'completed', 
           deactivated_at = $1, 
           total_duration_seconds = $2
       WHERE id = $3`,
      [deactivated_at, total_duration_seconds, event_id]
    );

    // ✅ Guardar métricas automáticamente en ms-metrics
    try {
      const fetch = require('node-fetch');
      await fetch(`${process.env.METRICS_URL || 'http://localhost:3004'}/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id,
          vehicles_notified: 0,
          avg_reaction_time_seconds: 0,
          semaphores_activated: 0,
          distance_km: 0
        })
      });
      console.log(`📊 Métricas registradas para ${event_id}`);
    } catch (metricsErr) {
      // No falla el flujo principal si metrics no responde
      console.warn('⚠️ No se pudieron guardar métricas:', metricsErr.message);
    }

    console.log(`✅ Emergencia cerrada en BD: ${event_id} - ${total_duration_seconds}s`);

    res.json({
      message: 'Emergencia desactivada',
      event_id,
      activated_at: event.activated_at,
      deactivated_at,
      total_duration_seconds,
      duration_minutes: (total_duration_seconds / 60).toFixed(2)
    });

  } catch (err) {
    console.error('Error BD deactivate:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// RF-12: Consultar estado de un evento
app.get('/emergency/:event_id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM emergency_events WHERE id = $1`,
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

// Listar todos los eventos activos
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ms-emergency', db: 'neon' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 ms-emergency corriendo en puerto ${PORT}`);
});