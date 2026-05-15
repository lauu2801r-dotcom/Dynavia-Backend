const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
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
  else console.log('✅ ms-notifications conectado a Neon');
});

function getInstruction(level, position) {
  const instructions = {
    1: {
      front:        '🚨 EMERGENCIA CRÍTICA: Oríllete inmediatamente a la derecha y detente.',
      behind:       '🚨 EMERGENCIA CRÍTICA: Reduce velocidad y mantén distancia.',
      side:         '🚨 EMERGENCIA CRÍTICA: Cede el paso, no cambies de carril.',
      intersection: '🚨 EMERGENCIA CRÍTICA: Detente completamente, no cruces.'
    },
    2: {
      front:        '⚠️ Ambulancia en camino: Por favor oríllete a la derecha.',
      behind:       '⚠️ Ambulancia en camino: Reduce velocidad gradualmente.',
      side:         '⚠️ Ambulancia en camino: Mantén tu carril y reduce velocidad.',
      intersection: '⚠️ Ambulancia en camino: Espera antes de cruzar.'
    },
    3: {
      front:        'ℹ️ Traslado médico cercano: Se recomienda ceder el paso.',
      behind:       'ℹ️ Traslado médico cercano: Mantén distancia prudente.',
      side:         'ℹ️ Traslado médico cercano: Mantén tu carril.',
      intersection: 'ℹ️ Traslado médico cercano: Procede con precaución.'
    }
  };
  return instructions[level]?.[position] || 'Atención: Ambulancia en la vía.';
}

function getProtocol(level) {
  const protocols = {
    1: { semaphore_sync: true,  semaphore_mode: 'full',    alert_type: 'mandatory',   description: 'Sincronización total de semáforos + notificación obligatoria' },
    2: { semaphore_sync: true,  semaphore_mode: 'partial', alert_type: 'preventive',  description: 'Semáforos parciales + alertas preventivas' },
    3: { semaphore_sync: false, semaphore_mode: 'none',    alert_type: 'informative', description: 'Solo alertas a conductores, sin intervención semafórica' }
  };
  return protocols[level] || protocols[3];
}

app.post('/notify', async (req, res) => {
  const { event_id, vehicle_id, level, position } = req.body;

  if (!event_id || !vehicle_id || !level || !position) {
    return res.status(400).json({ error: 'Faltan campos: event_id, vehicle_id, level, position' });
  }

  const positionKey = typeof position === 'object' ? 'front' : position;
  const instruction = getInstruction(level, positionKey);
  const protocol = getProtocol(level);
  const timestamp = new Date();

  try {
    await pool.query(
      `INSERT INTO notifications (event_id, vehicle_id, severity_level, position, instruction, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event_id, vehicle_id, level, JSON.stringify(position), instruction, timestamp]
    );

    console.log(`🔔 [Nivel ${level}] Notificación → ${vehicle_id} (${JSON.stringify(position)}): ${instruction}`);

    res.json({
      status: 'sent',
      vehicle_id,
      level,
      position,
      instruction,
      protocol,
      timestamp
    });

  } catch (err) {
    console.error('Error DB:', err.message);
    res.status(500).json({ error: 'Error guardando notificación' });
  }
});

app.get('/notifications/:event_id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications WHERE event_id = $1 ORDER BY sent_at DESC`,
      [req.params.event_id]
    );
    res.json({
      event_id: req.params.event_id,
      count: result.rows.length,
      notifications: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/notifications/:event_id/summary', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT severity_level, COUNT(*) as total, 
              COUNT(DISTINCT vehicle_id) as unique_vehicles
       FROM notifications WHERE event_id = $1
       GROUP BY severity_level`,
      [req.params.event_id]
    );
    res.json({ event_id: req.params.event_id, summary: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ms-notifications', db: 'neon' });
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`🔔 ms-notifications corriendo en puerto ${PORT}`);
});