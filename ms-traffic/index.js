const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const mqtt = require('mqtt');
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
  else console.log('✅ ms-traffic conectado a Neon');
});

// Conexión MQTT Mosquitto
const mqttClient = mqtt.connect(process.env.MQTT_BROKER || 'mqtt://broker.emqx.io:1883');

mqttClient.on('connect', () => {
  console.log('✅ ms-traffic conectado a Mosquitto MQTT');
});

mqttClient.on('error', (err) => {
  console.error('❌ Error MQTT:', err.message);
});

// RF-09: Qué nivel activa semáforos
function semaphoreMode(level) {
  if (level === 1) return 'full';
  if (level === 2) return 'partial';
  return 'none';
}

// RF-10: Activar semáforos en la ruta
app.post('/semaphore/activate', async (req, res) => {
  const { event_id, semaphores: semaphoreList, level } = req.body;

  if (!event_id || !semaphoreList || !level) {
    return res.status(400).json({ error: 'Faltan campos: event_id, semaphores, level' });
  }

  const mode = semaphoreMode(level);

  if (mode === 'none') {
    return res.json({
      status: 'skipped',
      event_id,
      level,
      reason: 'Nivel 3 no activa semáforos (RF-09)',
      semaphores_activated: 0
    });
  }

  const activated = [];

  try {
    for (const s of semaphoreList) {
      await pool.query(
        `INSERT INTO semaphore_events 
          (event_id, semaphore_id, lat, lng, status, mode, level, activated_at)
         VALUES ($1, $2, $3, $4, 'white', $5, $6, NOW())
         ON CONFLICT (event_id, semaphore_id) DO UPDATE SET
           status = 'white', activated_at = NOW()`,
        [event_id, s.semaphore_id, s.location?.lat || null,
         s.location?.lng || null, mode, level]
      );
      activated.push(s.semaphore_id);

      // ✅ Publicar señal MQTT al semáforo Arduino
      const topic = `dynavia/semaphore/${s.semaphore_id}`;
      const payload = JSON.stringify({
        semaphore_id: s.semaphore_id,
        command: 'white',
        mode,
        level,
        event_id
      });
      mqttClient.publish(topic, payload, { qos: 1 });
      console.log(`🚦 MQTT → ${topic}: luz blanca [Nivel ${level}]`);
    }

    // Publicar también en topic general para Wokwi
    mqttClient.publish('dynavia/semaphore/all', JSON.stringify({
      command: 'white',
      mode,
      level,
      event_id,
      semaphores: activated
    }), { qos: 1 });

    res.json({
      status: 'activated',
      event_id,
      level,
      mode,
      semaphores_activated: activated.length,
      semaphores: activated
    });

  } catch (err) {
    console.error('Error DB:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// RF-11: Restablecer todos los semáforos al finalizar
app.post('/semaphore/restore', async (req, res) => {
  const { event_id } = req.body;

  if (!event_id) return res.status(400).json({ error: 'Falta event_id' });

  try {
    const result = await pool.query(
      `UPDATE semaphore_events
       SET status = 'normal', restored_at = NOW()
       WHERE event_id = $1 AND status = 'white'
       RETURNING semaphore_id`,
      [event_id]
    );

    const restored = result.rows.map(r => r.semaphore_id);

    // ✅ Publicar restauración por MQTT
    mqttClient.publish('dynavia/semaphore/all', JSON.stringify({
      command: 'normal',
      event_id,
      semaphores: restored
    }), { qos: 1 });

    for (const semaphore_id of restored) {
      mqttClient.publish(`dynavia/semaphore/${semaphore_id}`, JSON.stringify({
        semaphore_id,
        command: 'normal',
        event_id
      }), { qos: 1 });
      console.log(`✅ MQTT → semáforo ${semaphore_id} restaurado`);
    }

    res.json({
      status: 'restored',
      event_id,
      semaphores_restored: restored.length,
      semaphores: restored
    });

  } catch (err) {
    console.error('Error DB:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Estado de semáforos de un evento
app.get('/semaphore/:event_id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM semaphore_events WHERE event_id = $1 ORDER BY activated_at ASC`,
      [req.params.event_id]
    );
    res.json({
      event_id: req.params.event_id,
      count: result.rows.length,
      semaphores: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ms-traffic', db: 'neon', mqtt: mqttClient.connected });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`🚦 ms-traffic corriendo en puerto ${PORT}`);
});