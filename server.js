const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Conexión estricta a PostgreSQL en la nube usando tu variable exacta de Render
const pool = new Pool({
    connectionString: process.env.DB_URI,
    ssl: { rejectUnauthorized: false }
});

// Inicialización automática de la estructura de datos relacional
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS activos (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(255) NOT NULL,
                codigo VARCHAR(100) UNIQUE NOT NULL,
                categoria VARCHAR(100) NOT NULL,
                ubicacion VARCHAR(255) NOT NULL
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS faltantes (
                id SERIAL PRIMARY KEY,
                elemento VARCHAR(255) NOT NULL,
                cantidad INT NOT NULL,
                prioridad VARCHAR(50) NOT NULL
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS danados (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(255) NOT NULL,
                codigo VARCHAR(100) NOT NULL,
                reporte VARCHAR(255) NOT NULL,
                fecha_reporte TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bitacora (
                id SERIAL PRIMARY KEY,
                accion VARCHAR(100) NOT NULL,
                detalles TEXT NOT NULL,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("📌 Estructura relacional de la base de datos verificada correctamente en la nube.");
    } catch (err) {
        console.error("❌ Error al inicializar la base de datos:", err);
    }
};
initDB();

// === MÓDULO DE AUTENTICACIÓN PRÁCTICO (TEXTO PLANO SIN ENCRIPCIÓN) ===
app.post('/api/login', (req, res) => {
    const { usuario, contrasena } = req.body;

    if (usuario === 'admin' && contrasena === 'admin123') {
        res.json({ token: "SESION_DIRECTA_ADMIN", rol: "admin", usuario: "admin" });
    } else if (usuario === 'user' && contrasena === 'user123') {
        res.json({ token: "SESION_DIRECTA_USER", rol: "user", usuario: "user" });
    } else {
        res.status(401).json({ error: "Credenciales incorrectas. Verifica tu usuario o contraseña." });
    }
});

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
            ['ALTA', `Se integró el activo ${nombre} (${codigo}).`]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if(err.code === '23505') return res.status(400).json({ error: "El código de activo ya existe en la red." });
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
            ['BAJA', `Se retiró permanentemente el activo ${activo.nombre} (${activo.codigo}).`]
        );
        res.json({ mensaje: "Activo eliminado físicamente de los servidores." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === ENDPOINTS DE REQUERIMIENTOS ===
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

app.put('/api/faltantes/:id', async (req, res) => {
    const { id } = req.params;
    const { cantidadAsurtir } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const buscando = await client.query('SELECT * FROM faltantes WHERE id = $1', [id]);
        if (buscando.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Requerimiento no encontrado." });
        }
        const fila = buscando.rows[0];
        if (cantidadAsurtir > fila.cantidad) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "La cantidad supera la demanda solicitada." });
        }
        const nuevaCantidad = fila.cantidad - cantidadAsurtir;
        if (nuevaCantidad === 0) {
            await client.query('DELETE FROM faltantes WHERE id = $1', [id]);
        } else {
            await client.query('UPDATE faltantes SET cantidad = $1 WHERE id = $2', [nuevaCantidad, id]);
        }
        for (let i = 0; i < cantidadAsurtir; i++) {
            const codigoAuto = `SRT-${id}-${Math.floor(1000 + Math.random() * 9000)}`;
            await client.query(
                'INSERT INTO activos (nombre, codigo, categoria, ubicacion) VALUES ($1, $2, $3, $4)',
                [fila.elemento, codigoAuto, 'Estaciones de Trabajo', 'Almacén Central / Recién Surtido']
            );
        }
        await client.query('INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)', ['SURTIDO', `Se ingresaron ${cantidadAsurtir} unidades de "${fila.elemento}" mediante el panel.`]);
        await client.query('COMMIT');
        res.json({ mensaje: "Surtido procesado exitosamente." });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// === ENDPOINTS DE DAÑADOS ===
app.get('/api/danados', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM danados ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/danados', async (req, res) => {
    const { nombre, codigo, reporte } = req.body;
    try {
        const result = await pool.query('INSERT INTO danados (nombre, codigo, reporte) VALUES ($1, $2, $3) RETURNING *', [nombre, codigo, reporte]);
        await pool.query('INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)', ['FALLA', `Reportado equipo dañado: ${nombre} (${codigo}).`]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/danados/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM danados WHERE id = $1', [id]);
        res.json({ mensaje: "Reporte archivado." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === ENDPOINT DE BITÁCORA ===
app.get('/api/bitacora', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bitacora ORDER BY id DESC LIMIT 40');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo sin caídas en el puerto ${PORT}`));