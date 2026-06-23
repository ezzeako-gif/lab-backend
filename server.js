const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de la conexión a PostgreSQL en Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Función para inicializar las tablas de la base de datos de forma limpia
async function inicializarBaseDeDatos() {
  try {
    // FORZAMOS LA LIMPIEZA DE LA TABLA VIEJA PARA CORREGIR LOS BLOQUEOS DE ÍNDICES
    await pool.query(`DROP TABLE IF EXISTS activos CASCADE;`);

    // 1. Tabla de Inventario Existente (Estructura Limpia)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activos (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(50) UNIQUE NOT NULL,
        nombre VARCHAR(100) NOT NULL,
        categoria VARCHAR(100) NOT NULL,
        ubicacion VARCHAR(150) NOT NULL,
        estado VARCHAR(50) DEFAULT 'Disponible'
      );
    `);

    // 2. Tabla de Bitácora de Auditoría (Inmutable)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bitacora (
        id SERIAL PRIMARY KEY,
        accion VARCHAR(50) NOT NULL,
        detalles TEXT NOT NULL,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Tabla de Requerimientos (Lo que hace falta)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS faltantes (
        id SERIAL PRIMARY KEY,
        elemento VARCHAR(150) NOT NULL,
        cantidad INT NOT NULL,
        prioridad VARCHAR(50) DEFAULT 'Media',
        fecha_solicitud TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("⚙️ Base de datos relacional PostgreSQL reiniciada e inicializada con éxito.");
  } catch (err) {
    console.error("❌ Error inicializando la base de datos:", err);
  }
}

inicializarBaseDeDatos();

// Ruta de diagnóstico (Despertador)
app.get('/', (req, res) => {
  res.send('⚙️ API de Trazabilidad Activa y Operando.');
});

/* ==========================================================================
   MÓDULO: GESTIÓN DE ACTIVOS EXISTENTES (ALTAS Y BAJAS)
   ========================================================================== */

// GET: Obtener inventario completo
app.get('/api/activos', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM activos ORDER BY id DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar inventario.' });
  }
});

// POST: Dar de ALTA un nuevo activo (y registrar log de auditoría)
app.post('/api/activos', async (req, res) => {
  const { nombre, codigo, categoria, ubicacion } = req.body;
  if (!nombre || !codigo || !categoria || !ubicacion) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios para el alta.' });
  }
  try {
    const queryActivo = `
      INSERT INTO activos (codigo, nombre, categoria, ubicacion) 
      VALUES ($1, $2, $3, $4) RETURNING *
    `;
    const nuevoActivo = await pool.query(queryActivo, [codigo, nombre, categoria, ubicacion]);

    // Insertar automáticamente el log en la bitácora
    const detallesLog = `Se registró el activo ${nombre} con código ${codigo} por Rosa Reyes.`;
    await pool.query(
      'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
      ['ALTA_ACTIVO', detallesLog]
    );

    res.status(201).json({ mensaje: 'Activo desplegado con éxito.', activo: nuevoActivo.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al insertar activo. Asegúrate de que el código no esté duplicado.' });
  }
});

// DELETE: Dar de BAJA un activo por su código único (y registrar log de auditoría)
app.delete('/api/activos/:codigo', async (req, res) => {
  const { codigo } = req.params;
  try {
    const buscarActivo = await pool.query('SELECT nombre FROM activos WHERE codigo = $1', [codigo]);
    
    if (buscarActivo.rows.length === 0) {
      return res.status(404).json({ error: 'El activo solicitado no existe en el sistema.' });
    }

    const nombreActivo = buscarActivo.rows[0].nombre;

    // Eliminar el activo físicamente de la base de datos
    await pool.query('DELETE FROM activos WHERE codigo = $1', [codigo]);

    // Insertar log de la baja en la bitácora
    const detallesLog = `Se retiró y dio de BAJA el activo ${nombreActivo} (Código: ${codigo}) por Rosa Reyes por obsolescencia o mantenimiento.`;
    await pool.query(
      'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
      ['BAJA_ACTIVO', detallesLog]
    );

    res.json({ mensaje: `Activo ${codigo} eliminado correctamente del inventario.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno al procesar la baja del activo.' });
  }
});

/* ==========================================================================
   MÓDULO: BITÁCORA DE AUDITORÍA
   ========================================================================== */

// GET: Consultar los logs históricos de seguridad
app.get('/api/bitacora', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM bitacora ORDER BY id DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar la bitácora.' });
  }
});

/* ==========================================================================
   MÓDULO: REQUERIMIENTOS (COMPONENTES FALTANTES)
   ========================================================================== */

// GET: Obtener la lista de elementos que hacen falta
app.get('/api/faltantes', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM faltantes ORDER BY id DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar la lista de faltantes.' });
  }
});

// POST: Registrar una nueva necesidad o insumo faltante (¡CORREGIDO!)
app.post('/api/faltantes', async (req, res) => {
  const { elemento, cantidad, prioridad } = req.body;
  if (!elemento || !cantidad) {
    return res.status(400).json({ error: 'El nombre del elemento y la cantidad son obligatorios.' });
  }
  try {
    const queryFaltante = `
      INSERT INTO faltantes (elemento, cantidad, prioridad) 
      VALUES ($1, $2, $3) RETURNING *
    `;
    const nuevoFaltante = await pool.query(queryFaltante, [elemento, cantidad, prioridad || 'Media']);
    
    // CORRECCIÓN AQUÍ: Se cambió "fante" por "faltante" para que coincida con la lectura del Frontend
    res.status(201).json({ mensaje: 'Requerimiento registrado con éxito.', faltante: nuevoFaltante.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar el faltante.' });
  }
});

// Puerto de escucha en producción
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor lógico corriendo de forma segura en el puerto ${PORT}`);
});