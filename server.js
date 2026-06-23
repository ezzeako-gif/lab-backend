const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DB_URI,
    ssl: { rejectUnauthorized: false }
});

// Inicialización de Tablas (Agregamos la tabla de dañados)
const initDB = async () => {
    try {
        // Tabla de activos existentes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS activos (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(255) NOT NULL,
                codigo VARCHAR(100) UNIQUE NOT NULL,
                categoria VARCHAR(100) NOT NULL,
                ubicacion VARCHAR(255) NOT NULL
            );
        `);
        // Tabla de requerimientos / faltantes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS faltantes (
                id SERIAL PRIMARY KEY,
                elemento VARCHAR(255) NOT NULL,
                cantidad INT NOT NULL,
                prioridad VARCHAR(50) NOT NULL
            );
        `);
        // Tabla de sistemas dañados (¡NUEVA!)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS danados (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(255) NOT NULL,
                codigo VARCHAR(100) NOT NULL,
                reporte VARCHAR(255) NOT NULL,
                fecha_reporte TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Tabla de bitácora
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bitacora (
                id SERIAL PRIMARY KEY,
                accion VARCHAR(100) NOT NULL,
                detalles TEXT NOT NULL,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("📌 Estructura de base de datos relacional lista y verificada.");
    } catch (err) {
        console.error("❌ Error al inicializar la base de datos:", err);
    }
};
initDB();

// === ENDPOINTS DE ACTIVOS ===
app.get('/api/activos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM activos ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/activos', async (req, res) => {
    const { nombre, codigo, categoria, ubicacion } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO activos (nombre, codigo, categoria, ubicacion) VALUES ($1, $2, $3, $4) RETURNING *',
            [nombre, codigo, categoria, ubicacion]
        );
        await pool.query(
            'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
            ['ALTA', `Se integró el activo ${nombre} (${codigo}) por Rosa Reyes`]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if(err.code === '23505') return res.status(400).json({ error: "El código de activo ya existe." });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/activos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const buscando = await pool.query('SELECT * FROM activos WHERE id = $1', [id]);
        if(buscando.rows.length === 0) return res.status(404).json({ error: "Activo no encontrado." });
        
        const activo = buscando.rows[0];
        await pool.query('DELETE FROM activos WHERE id = $1', [id]);
        await pool.query(
            'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
            ['BAJA', `Se retiró del inventario el activo ${activo.nombre} (${activo.codigo}) por Rosa Reyes`]
        );
        res.json({ mensaje: "Activo eliminado físicamente." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === ENDPOINTS DE REQUERIMIENTOS (CON INTERCONEXIÓN LOGÍSTICA) ===
app.get('/api/faltantes', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM faltantes ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/faltantes', async (req, res) => {
    const { elemento, cantidad, prioridad } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO faltantes (elemento, cantidad, prioridad) VALUES ($1, $2, $3) RETURNING *',
            [elemento, cantidad, prioridad]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Surtir stock -> ¡Modificado para añadir automáticamente a activos!
app.put('/api/faltantes/:id', async (req, res) => {
    const { id } = req.params;
    const { cantidadAsurtir } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Iniciamos una transacción atómica

        const buscando = await client.query('SELECT * FROM faltantes WHERE id = $1', [id]);
        if (buscando.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Requerimiento no encontrado." });
        }

        const fila = buscando.rows[0];
        if (cantidadAsurtir > fila.cantidad) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "La cantidad ingresada supera la demanda requerida." });
        }

        const nuevaCantidad = fila.cantidad - cantidadAsurtir;
        let mensajeAdicional = "";

        // 1. Actualizar o eliminar de la lista de faltantes
        if (nuevaCantidad === 0) {
            await client.query('DELETE FROM faltantes WHERE id = $1', [id]);
            mensajeAdicional = " El requerimiento fue completado y cerrado.";
        } else {
            await client.query('UPDATE faltantes SET cantidad = $1 WHERE id = $2', [nuevaCantidad, id]);
            mensajeAdicional = ` Quedan ${nuevaCantidad} unidades pendientes de recibir.`;
        }

        // 2. LOGÍSTICA AUTOMÁTICA: Insertar las unidades surtidas como activos listos en el módulo principal
        for (let i = 0; i < cantidadAsurtir; i++) {
            // Generamos un código único secuencial o aleatorio basado en el ID para evitar choques de llave primaria
            const codigoAutomatico = `SRT-${id}-${Math.floor(1000 + Math.random() * 9000)}`;
            await client.query(
                'INSERT INTO activos (nombre, codigo, categoria, ubicacion) VALUES ($1, $2, $3, $4)',
                [fila.elemento, codigoAutomatico, 'Estaciones de Trabajo', 'Almacén Central / Recién Surtido']
            );
        }

        // 3. Registrar en la bitácora
        await client.query(
            'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
            ['SURTIDO', `Se ingresaron ${cantidadAsurtir} unidades de "${fila.elemento}" al inventario de Activos Físicos por Rosa Reyes.`]
        );

        await client.query('COMMIT'); // Guardamos todos los cambios de forma segura
        res.json({ mensaje: `Insumo procesado con éxito.${mensajeAdicional} Las unidades se migraron al Módulo de Activos.` });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// === ENDPOINTS DE SISTEMAS DAÑADOS (¡NUEVOS!) ===
app.get('/api/danados', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM danados ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/danados', async (req, res) => {
    const { nombre, codigo, reporte } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO danados (nombre, codigo, reporte) VALUES ($1, $2, $3) RETURNING *',
            [nombre, codigo, reporte]
        );
        await pool.query(
            'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
            ['FALLA', `Mantenimiento: Reportado equipo dañado: ${nombre} (${codigo}). Detalle: ${reporte}`]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/danados/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM danados WHERE id = $1', [id]);
        res.json({ mensaje: "Reporte de falla archivado." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === ENDPOINT DE BITÁCORA ===
app.get('/api/bitacora', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bitacora ORDER BY id DESC LIMIT 40');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor de Trazabilidad corriendo en el puerto ${PORT}`));