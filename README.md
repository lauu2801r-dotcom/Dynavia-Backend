# Dynavia — Backend

Sistema distribuido de coordinación dinámica de despeje vehicular para ambulancias, basado en geolocalización en tiempo real, arquitectura de microservicios y simulación IoT con semáforos inteligentes.

**Stack:** Node.js · Docker · MQTT (Mosquitto) · WebSockets · PostgreSQL (NeonDB) · REST APIs

---

## ¿Qué es Dynavia?

Dynavia es un prototipo de sistema inteligente desarrollado para optimizar el desplazamiento de ambulancias en emergencias dentro de la localidad de Usaquén, Bogotá. Cuando una ambulancia activa el modo emergencia, el sistema:

- Transmite su ubicación GPS en tiempo real
- Detecta vehículos en un radio de 300–500 metros
- Envía notificaciones personalizadas a conductores cercanos
- Sincroniza semáforos inteligentes simulados vía WebSockets
- Registra métricas de respuesta y eficiencia vial

---

## Microservicios

| Microservicio | Responsabilidad |
|---|---|
| `ms-emergency` | Activación y clasificación del modo emergencia |
| `ms-geolocation` | GPS en tiempo real, cálculo de rutas y proximidad |
| `ms-notifications` | Alertas personalizadas a conductores cercanos |
| `ms-traffic` | Control de semáforos simulados vía WebSockets |
| `ms-metrics` | Generación de métricas y estadísticas del sistema |

---

## Arquitectura

- **5 microservicios independientes** orquestados con Docker Compose
- **Broker MQTT (Mosquitto)** para comunicación entre servicios
- **WebSockets** para sincronización de semáforos en tiempo real
- **Dashboard HTML** para monitoreo del sistema en tiempo real
- **PostgreSQL en NeonDB** como base de datos centralizada

---

## Stack técnico

- **Node.js** — runtime principal de los microservicios
- **Docker & Docker Compose** — contenedores y orquestación
- **Mosquitto (MQTT)** — broker de mensajería IoT
- **WebSockets** — comunicación en tiempo real con semáforos simulados
- **PostgreSQL (NeonDB)** — base de datos relacional en la nube
- **REST APIs** — comunicación entre microservicios y clientes

---

## Cómo correr el proyecto

### 1. Clonar el repositorio
```bash
git clone https://github.com/lauu2801r-dotcom/Dynavia-Backend.git
cd Dynavia-Backend
```

### 2. Configurar variables de entorno
Crea un archivo `.env` en la raíz:

DATABASE_URL=postgresql://usuario:contraseña@host/dynavia

MQTT_BROKER_URL=mqtt://localhost:1883

### 3. Levantar todos los servicios
```bash
docker-compose up --build
```

Esto levanta los 5 microservicios + el broker Mosquitto automáticamente.

### 4. Abrir el dashboard
Abre `dashboard.html` en el navegador para monitorear el sistema en tiempo real.

---

## Estructura del proyecto
Dynavia-Backend/

├── mosquitto/config/     # Configuración del broker MQTT

├── ms-emergency/         # Microservicio de gestión de emergencias

├── ms-geolocation/       # Microservicio de geolocalización GPS

├── ms-metrics/           # Microservicio de métricas

├── ms-notifications/     # Microservicio de notificaciones

├── ms-traffic/           # Microservicio de semáforos simulados

├── dashboard.html        # Panel de monitoreo en tiempo real

└── docker-compose.yml    # Orquestación de contenedores

---

## Contexto académico

Proyecto de la asignatura **Sistemas Distribuidos**  
Universidad Manuela Beltrán · Bogotá, Colombia · 2026  
Autoras: Laura Valentina González Rojas · Valery Teheran Bernett  
Docente: Juan José Osorio Tabares
