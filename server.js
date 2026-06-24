const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); // Agregado para seguridad nativa
const jwt = require('jsonwebtoken');  // Agregado para tokens reales
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Clave secreta fija para firmar tus sesiones de auditoría
const JWT_SECRET = "CLAVE_SECRETA_SUPER_SEGURA_LAB_TI";

// Conexión estricta a PostgreSQL en la nube usando tu variable de entorno exacta de Render
const pool = new Pool({
    connectionString: process.env.DB_URI,
    ssl: { rejectUnauthorized: false }
});

// Inicialización automática de la estructura de datos relacional
const initDB = async () => {
    try {
        // Nueva tabla de usuarios para soportar las firmas crípticas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                usuario VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                rol VARCHAR(20) NOT NULL CHECK (rol IN ('admin', 'user'))
            );
        `);

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

        // Insertar usuarios iniciales por defecto de forma segura si no existen
        const checarUsuarios = await pool.query('SELECT COUNT(*) FROM usuarios');
        if (parseInt(checarUsuarios.rows[0].count) === 0) {
            const saltAdmin = await bcrypt.genSalt(10);
            const passAdmin = await bcrypt.hash('admin123', saltAdmin);
            const saltUser = await bcrypt.genSalt(10);
            const passUser = await bcrypt.hash('user123', saltUser);

            await pool.query('INSERT INTO usuarios (usuario, password, rol) VALUES ($1, $2, $3)', ['admin', passAdmin, 'admin']);
            await pool.query('INSERT INTO usuarios (usuario, password, rol) VALUES ($1, $2, $3)', ['user', passUser, 'user']);
            console.log("👥 Usuarios de auditoría inicializados por defecto ('admin' y 'user').");
        }

        console.log("📌 Estructura relacional de la base de datos verificada correctamente en la nube.");
    } catch (err) {
        console.error("❌ Error al inicializar la base de datos:", err);
    }
};
initDB();

// === MIDDLEWARE DE VERIFICACIÓN DE SEGURIDAD TOKENS ===
function verificarToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: "Acceso denegado. Token faltante." });

    try {
        const tokenLimpio = token.split(" ")[1];
        const verificado = jwt.verify(tokenLimpio, JWT_SECRET);
        req.usuario = verificado;
        next();
    } catch (error) {
        res.status(401).json({ error: "Token de sesión inválido o expirado." });
    }
}

// === MÓDULO DE AUTENTICACIÓN MEJORADO (CON BCRYPT Y JWT) ===
app.post('/api/login', async (req, res) => {
    const { usuario, contrasena } = req.body; // Mantenemos tus variables 'usuario' y 'contrasena'

    try {
        const resultado = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', [usuario]);
        if (resultado.rows.length === 0) {
            return res.status(401).json({ error: "Credenciales incorrectas. Verifica tu usuario o contraseña." });
        }

        const user = resultado.rows[0];
        
        // Comparación segura con el Hash de tu base de datos
        const passwordValida = await bcrypt.compare(contrasena, user.password);
        if (!passwordValida) {
            return res.status(401).json({ error: "Credenciales incorrectas. Verifica tu usuario o contraseña." });
        }

        // Firmamos el token con su rol correspondiente
        const token = jwt.sign({ id: user.id, rol: user.rol, usuario: user.usuario }, JWT_SECRET, { expiresIn: '2h' });

        await pool.query(
            'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
            ['LOGIN', `Inicio de sesión exitoso de: ${usuario}`]
        );

        res.json({ token: token, rol: user.rol, usuario: user.usuario });
    } catch (err) {
        res.status(500).json({ error: "Error en el servidor de autenticación." });
    }
});

// === ENDPOINTS DE ACTIVOS ===
app.get('/api/activos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM activos ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/activos', verificarToken, async (req, res) => {
    const { nombre, codigo, categoria, ubicacion } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO activos (nombre, codigo, categoria, ubicacion) VALUES ($1, $2, $3, $4) RETURNING *',
            [nombre, codigo, categoria, ubicacion]
        );
        await pool.query(
            'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
            ['ALTA', `Se integró el activo ${nombre} (${codigo}) por ${req.usuario.usuario}.`]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if(err.code === '23505') return res.status(400).json({ error: "El código de activo ya existe en la red." });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/activos/:id', verificarToken, async (req, res) => {
    const { id } = req.params;
    if (req.usuario.rol !== 'admin') return res.status(403).json({ error: "Privilegios insuficientes de Administrador." });
    
    try {
        const buscando = await pool.query('SELECT * FROM activos WHERE id = $1', [id]);
        if(buscando.rows.length === 0) return res.status(404).json({ error: "Activo no encontrado." });
        
        const activo = buscando.rows[0];
        await pool.query('DELETE FROM activos WHERE id = $1', [id]);
        await pool.query(
            'INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)',
            ['BAJA', `Se retiró permanentemente el activo ${activo.nombre} (${activo.codigo}) por ${req.usuario.usuario}.`]
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

app.post('/api/faltantes', verificarToken, async (req, res) => {
    const { elemento, cantidad, prioridad } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO faltantes (elemento, cantidad, prioridad) VALUES ($1, $2, $3) RETURNING *',
            [elemento, cantidad, prioridad]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/faltantes/:id', verificarToken, async (req, res) => {
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
        await client.query('INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)', ['SURTIDO', `Se ingresaron ${cantidadAsurtir} unidades de "${fila.elemento}" por ${req.usuario.usuario}.`]);
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

app.post('/api/danados', verificarToken, async (req, res) => {
    const { nombre, codigo, reporte } = req.body;
    try {
        const result = await pool.query('INSERT INTO danados (nombre, codigo, reporte) VALUES ($1, $2, $3) RETURNING *', [nombre, codigo, reporte]);
        await pool.query('INSERT INTO bitacora (accion, detalles) VALUES ($1, $2)', ['FALLA', `Reportado equipo dañado: ${nombre} (${codigo}) por ${req.usuario.usuario}.`]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/danados/:id', verificarToken, async (req, res) => {
    const { id } = req.params;
    if (req.usuario.rol !== 'admin') return res.status(403).json({ error: "Acción restringida a administradores." });
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

const PORT = process.env.PORT || 50000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo sin caídas en el puerto ${PORT}`));