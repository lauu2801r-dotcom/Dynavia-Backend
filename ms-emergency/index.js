const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Almacenamiento temporal en memoria (luego conectamos PostgreSQL)
let events = {};

// RF-01, RF-02: Activar emergencia
app.post('/emergency/activate', (req, res) => {
  const { ambulance_id, level, punto_b } = req.body;

  if (!ambulance_id || !level || !punto_b) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  if (![1, 2, 3].includes(level)) {
    return res.status(400).json({ error: 'Nivel debe ser 1, 2 o 3' });
  }

  const event_id = uuidv4();
  const start_time = new Date();

  events[event_id] = {
    event_id,
    ambulance_id,
    level,
    punto_b,
    start_time,
    status: 'active'
  };

  console.log(`🚨 Emergencia activada: ${event_id} - Nivel ${level}`);

  res.status(201).json({
    message: 'Modo emergencia activado',
    event_id,
    start_time,
    level
  });
});

// RF-03: Desactivar emergencia
app.post('/emergency/deactivate', (req, res) => {
  const { event_id } = req.body;

  if (!events[event_id]) {
    return res.status(404).json({ error: 'Evento no encontrado' });
  }

  const event = events[event_id];
  const end_time = new Date();
  const duration_ms = end_time - new Date(event.start_time);
  const duration_minutes = (duration_ms / 60000).toFixed(2);

  events[event_id] = {
    ...event,
    end_time,
    duration_minutes,
    status: 'completed'
  };

  console.log(`✅ Emergencia cerrada: ${event_id} - Duración: ${duration_minutes} min`);

  res.json({
    message: 'Emergencia desactivada',
    event_id,
    start_time: event.start_time,
    end_time,
    duration_minutes
  });
});

// RF-12: Consultar estado de un evento
app.get('/emergency/:event_id', (req, res) => {
  const { event_id } = req.params;
  const event = events[event_id];

  if (!event) {
    return res.status(404).json({ error: 'Evento no encontrado' });
  }

  res.json(event);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ms-emergency' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 ms-emergency corriendo en puerto ${PORT}`);
});