const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DB_URI,
});

// Función automática para crear las tablas si no existen
async function inicializarBaseDeDatos() {
  try {
    // Crear tabla activos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        codigo VARCHAR(50) UNIQUE NOT NULL,
        categoria VARCHAR(100) NOT NULL,
        ubicacion VARCHAR(150) NOT NULL,
        estado VARCHAR(50) DEFAULT 'Disponible',
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Crear tabla bitacora
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bitacora (
        id SERIAL PRIMARY KEY,
        accion VARCHAR(50) NOT NULL,
        detalles TEXT NOT NULL,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('📋 Estructura de tablas verificada/creada con éxito en PostgreSQL.');
  } catch (err) {
    console.error('❌ Error creando las tablas iniciales:', err.stack);
  }
}

// Conectar y ejecutar la creación de tablas
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Error de conexión a la base de datos remota:', err.stack);
  }
  console.log('✅ Conexión exitosa a la base de datos PostgreSQL en Render.');
  release();
  inicializarBaseDeDatos(); // <-- Llamada mágica
});

app.get('/api/activos', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM activos ORDER BY id DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar los activos en la red.' });
  }
});

app.post('/api/activos', async (req, res) => {
  const { nombre, codigo, categoria, ubicacion } = req.body;
  if (!nombre || !codigo || !categoria || !ubicacion) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }
  try {
    await pool.query('BEGIN');
    const queryActivo = `
      INSERT INTO activos (nombre, codigo, categoria, ubicacion, estado) 
      VALUES ($1, $2, $3, $4, 'Disponible') RETURNING *
    `;
    const nuevoActivo = await pool.query(queryActivo, [nombre, codigo, categoria, ubicacion]);

    const queryBitacora = `
      INSERT INTO bitacora (accion, detalles) 
      VALUES ('ALTA_ACTIVO', $1)
    `;
    const detallesLog = `Se registró el activo ${nombre} con código ${codigo} por Rosa Reyes.`;
    await pool.query(queryBitacora, [detallesLog]);

    await pool.query('COMMIT');
    res.status(201).json({ mensaje: 'Activo registrado con éxito en la red.', activo: nuevoActivo.rows[0] });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error interno al procesar el registro.' });
  }
});

app.get('/api/bitacora', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM bitacora ORDER BY fecha DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar la bitácora de auditoría.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor lógico corriendo en el puerto ${PORT}`);
});