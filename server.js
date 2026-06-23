const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

// Configuración de Middlewares
app.use(cors());
app.use(express.json());

// Conexión a PostgreSQL usando la variable de entorno de Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Inicialización de la Base de Datos (Creación de tablas relacionales)
const inicializarBD = async () => {
  try {
    // 1. Tabla de Activos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        codigo VARCHAR(50) UNIQUE NOT NULL,
        categoria VARCHAR(50) NOT NULL,
        ubicacion VARCHAR(100) NOT NULL,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Tabla de Faltantes (Requerimientos)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS faltantes (
        id SERIAL PRIMARY KEY,
        elemento VARCHAR(100) NOT NULL,
        cantidad INT NOT NULLCHECK (cantidad >= 0),
        prioridad VARCHAR(20) NOT NULL,
        fecha_solicitud TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Tabla de Bitácora de Auditoría de Seguridad
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bitacora (
        id SERIAL PRIMARY KEY,
        accion VARCHAR(50) NOT NULL,
        detalles TEXT NOT NULL,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('⚙️ Base de datos relacional PostgreSQL reiniciada e inicializada con éxito.');
  } catch (err) {
    console.error('❌ Error al inicializar las tablas en PostgreSQL:', err);
  }
};

inicializarBD();

// ==========================================
// 🏢 MÓDULO 1: CONTROL DE ACTIVOS TI
// ==========================================

// GET: Obtener todos los activos
app.get('/api/activos', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM activos ORDER BY id DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la lista de activos.' });
  }
});

// POST: Registrar un nuevo activo físico
app.post('/api/activos', async (req, res) => {
  const { nombre, codigo, categoria, ubicacion } = req.body;
  try {
    const nuevoActivo = await pool.query(
      'INSERT INTO activos (nombre, codigo, categoria, ubicacion) VALUES ($1, $2, $3, $4) RETURNING *',
      [nombre, codigo, categoria, ubicacion]
    );

    // Registro automático en la Bitácora de Auditoría
    await pool.query(
      'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
      ['ALTA_ACTIVO', `Se ingresó el activo [${codigo}] ${nombre} en ${ubicacion} por Rosa Reyes.`]
    );

    res.status(201).json(nuevoActivo.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      res.status(400).json({ error: 'El código único del activo ya está registrado en el sistema.' });
    } else {
      res.status(500).json({ error: 'Error interno al registrar el activo.' });
    }
  }
});

// DELETE: Dar de baja un activo físico
app.delete('/api/activos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const buscarActivo = await pool.query('SELECT nombre, codigo FROM activos WHERE id = $1', [id]);
    
    if (buscarActivo.rows.length === 0) {
      return res.status(404).json({ error: 'El activo que deseas eliminar no existe.' });
    }

    const { nombre, codigo } = buscarActivo.rows[0];

    await pool.query('DELETE FROM activos WHERE id = $1', [id]);

    // Registro de la eliminación en la Bitácora de Auditoría
    await pool.query(
      'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
      ['BAJA_ACTIVO', `Se retiró del inventario el activo [${codigo}] ${nombre} por Rosa Reyes.`]
    );

    res.json({ mensaje: 'Activo eliminado correctamente e inspección guardada.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno al dar de baja el activo.' });
  }
});

// ==========================================
// 📥 MÓDULO 2: REQUERIMIENTOS Y STOCK FALTANTE
// ==========================================

// GET: Obtener necesidades del laboratorio
app.get('/api/faltantes', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM faltantes ORDER BY id DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la lista de requerimientos.' });
  }
});

// POST: Registrar un elemento faltante
app.post('/api/faltantes', async (req, res) => {
  const { elemento, cantidad, prioridad } = req.body;
  try {
    const nuevoFaltante = await pool.query(
      'INSERT INTO faltantes (elemento, cantidad, prioridad) VALUES ($1, $2, $3) RETURNING *',
      [elemento, cantidad, prioridad]
    );

    res.status(201).json(nuevoFaltante.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno al registrar el requerimiento.' });
  }
});

// PUT: Llenar o restar stock de un elemento faltante (¡Cierra ciclo y elimina si llega a 0!)
app.put('/api/faltantes/:id', async (req, res) => {
  const { id } = req.params;
  const { cantidadAsurtir } = req.body;

  if (!cantidadAsurtir || cantidadAsurtir <= 0) {
    return res.status(400).json({ error: 'La cantidad a surtir debe ser mayor a cero.' });
  }

  try {
    const buscarFaltante = await pool.query('SELECT elemento, cantidad FROM faltantes WHERE id = $1', [id]);
    
    if (buscarFaltante.rows.length === 0) {
      return res.status(404).json({ error: 'El requerimiento solicitado no existe.' });
    }

    const { elemento, cantidad: cantidadActual } = buscarFaltante.rows[0];
    const nuevaCantidad = cantidadActual - cantidadAsurtir;

    if (nuevaCantidad <= 0) {
      // Si se surtió todo el material necesario, se elimina de la lista
      await pool.query('DELETE FROM faltantes WHERE id = $1', [id]);
      
      await pool.query(
        'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
        ['STOCK_COMPLETO', `Se completó al 100% el stock faltante de ${elemento} por Rosa Reyes.`]
      );

      return res.json({ mensaje: `¡Stock de ${elemento} completado! Se ha removido de la lista.` });
    } 
    
    // Si quedan unidades pendientes, se actualiza la cantidad restante
    const actualizarQuery = 'UPDATE faltantes SET cantidad = $1 WHERE id = $2 RETURNING *';
    const resultadoActualizado = await pool.query(actualizarQuery, [nuevaCantidad, id]);

    await pool.query(
      'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
      ['ABONO_STOCK', `Se surtieron ${cantidadAsurtir} unidades de ${elemento}. Restan por conseguir: ${nuevaCantidad} por Rosa Reyes.`]
    );

    res.json({ mensaje: 'Stock restado correctamente.', faltante: resultadoActualizado.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno al actualizar el stock faltante.' });
  }
});

// ==========================================
// 🛡️ MÓDULO 3: BITÁCORA DE SEGURIDAD Y AUDITORÍA
// ==========================================

// GET: Obtener registros de auditoría
app.get('/api/bitacora', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM bitacora ORDER BY id DESC LIMIT 30');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar la bitácora de auditoría.' });
  }
});

// Puerto dinámico para producción (Render usa el 10000 por defecto si no hay PORT declarado)
const PUERTO = process.env.PORT || 10000;
app.listen(PUERTO, () => {
  console.log(`🚀 Servidor de Trazabilidad corriendo de forma segura en el puerto ${PUERTO}`);
});