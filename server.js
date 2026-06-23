const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Configuración de Middlewares
app.use(cors());
app.use(express.json());

// Conexión al clúster de PostgreSQL en la nube
const pool = new Pool({
  connectionString: process.env.DB_URI,
});

// Probar conexión inicial
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Error de conexión a la base de datos remota:', err.stack);
  }
  console.log('✅ Conexión exitosa a la base de datos PostgreSQL en Render.');
  release();
});

// 1. OBTENER TODOS LOS ACTIVOS (Dashboard e Inventario)
app.get('/api/activos', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM activos ORDER BY id DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar los activos en la red.' });
  }
});

// 2. REGISTRAR UN NUEVO ACTIVO + GENERAR BITÁCORA AUTOMÁTICA
app.post('/api/activos', async (req, res) => {
  const { nombre, codigo, categoria, ubicacion } = req.body;

  // Validación estricta en el Backend (Manejo de Errores)
  if (!nombre || !codigo || !categoria || !ubicacion) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  try {
    // Iniciar una transacción para asegurar la consistencia del sistema
    await pool.query('BEGIN');

    // Insertar el activo tecnológico
    const queryActivo = `
      INSERT INTO activos (nombre, codigo, categoria, ubicacion, estado) 
      VALUES ($1, $2, $3, $4, 'Disponible') RETURNING *
    `;
    const nuevoActivo = await pool.query(queryActivo, [nombre, codigo, categoria, ubicacion]);

    // Insertar automáticamente el log en la Bitácora de Auditoría (Trazabilidad)
    const queryBitacora = `
      INSERT INTO bitacora (accion, detalles) 
      VALUES ('ALTA_ACTIVO', $1)
    `;
    const detallesLog = `Se registró el activo ${nombre} con código ${codigo} por Rosa Reyes.`;
    await pool.query(queryBitacora, [detallesLog]);

    // Consolidar la transacción
    await pool.query('COMMIT');

    res.status(201).json({ 
      mensaje: 'Activo registrado con éxito en la red.', 
      activo: nuevoActivo.rows[0] 
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error interno al procesar el registro.' });
  }
});

// 3. VER EL HISTORIAL DE LA BITÁCORA DE AUDITORÍA
app.get('/api/bitacora', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM bitacora ORDER BY fecha DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar la bitácora de auditoría.' });
  }
});

// Arrancar el Servidor
app.listen(PORT, () => {
  console.log(`Servidor lógico corriendo en el puerto ${PORT}`);
});