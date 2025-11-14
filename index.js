// ===============================
// 📦 DEPENDENCIAS
// ===============================
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
let Pool; // Lazy-loaded only if USE_PG is enabled

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// 🧰 MIDDLEWARE
// ===============================
app.use(cors());
app.use(express.json());

// ===============================
// 📨 SENDGRID - endpoint para notificar al requisitor
// ===============================
const sgMail = require('@sendgrid/mail');
const EMAIL_FROM = process.env.EMAIL_FROM || 'gestiondecomp@playlearn.com';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('⚠️ SENDGRID_API_KEY no definido. El endpoint de notificaciones no enviará correos hasta configurar la API key.');
}

/**
 * POST /api/notify/requisitor
 * Body esperado: { to, subject, body, vacancyId? }
 */
app.post('/api/notify/requisitor', async (req, res) => {
  try {
    const { to, subject, body } = req.body || {};
    if (!to || !subject || !body) {
      return res.status(400).json({ ok: false, error: 'Faltan campos: to, subject, body' });
    }

    if (!process.env.SENDGRID_API_KEY) {
      // En desarrollo, si no hay API key, devolvemos OK para que frontend no trunque
      console.log('Simulando envío de correo (no hay SENDGRID_API_KEY):', { to, subject });
      return res.json({ ok: true, simulated: true, message: 'Simulación: SENDGRID_API_KEY no configurada' });
    }

    const isHtml = /<[^>]+>/.test(String(body||''));
    const htmlBody = isHtml ? body : String(body||'').replace(/\n/g, '<br>');
    const textBody = isHtml ? String(body||'').replace(/<[^>]*>/g, '') : String(body||'');
    const msg = {
      to,
      from: { email: EMAIL_FROM, name: 'Plataforma de Gestión de Competencias' },
      subject,
      html: htmlBody,
      text: textBody
    };

    await sgMail.send(msg);
    console.log(`✅ Mail enviado a ${to} (asunto: ${subject})`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error enviando correo (notify/requisitor):', err?.response?.body || err.message || err);
    return res.status(500).json({ ok: false, error: 'Mail send failed' });
  }
});


// Servir estáticos del Frontend si lo necesitas local
app.use(express.static(path.join(__dirname, '..', 'Frontend')));

app.get('/', (req, res) => {
  res.send('✅ Servidor activo y funcionando correctamente');
});

// ===============================
// 📊 BASE DE DATOS (Postgres o SQLite)
// ===============================
const USE_PG = !!process.env.DATABASE_URL || !!process.env.PGHOST;

let db;          // SQLite handle
let pgPool;      // Postgres pool

async function migrateSQLite() {
  // Permite definir directorio de DB desde variable de entorno (útil para Render Disk)
  const DB_DIR = process.env.DB_DIR || __dirname;
  const DB_FILE = process.env.DB_FILE || 'database.db';
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
  } catch (e) {
    console.error('❌ No se pudo asegurar el directorio de la DB:', DB_DIR, e.message);
  }
  const DB_PATH = path.join(DB_DIR, DB_FILE);

  db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('❌ Error al conectar con la base de datos:', err.message);
    } else {
      console.log('✅ Conectado a la base de datos SQLite en', DB_PATH);
    }
  });

  // Tabla base
  db.run(`
    CREATE TABLE IF NOT EXISTS vacantes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      area TEXT,
      requisitor TEXT,
      tipoProceso TEXT,
      tipo TEXT,
      prioridad TEXT,
      fecha TEXT,
      comentarios TEXT,
      estatus TEXT
    )
  `);

  // ➕ Migración segura de columnas nuevas
  function ensureColumn(table, column, definition) {
    return new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(${table});`, [], (err, rows) => {
        if (err) return reject(err);
        const exists = rows.some(r => r.name === column);
        if (exists) return resolve('exists');
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`, [], (err2) => {
          if (err2) return reject(err2);
          resolve('added');
        });
      });
    });
  }

  try {
    await ensureColumn('vacantes', 'folio', 'TEXT');
    await ensureColumn('vacantes', 'fechaInicio', 'TEXT');
    await ensureColumn('vacantes', 'habilidades', 'TEXT');
    await ensureColumn('vacantes', 'terna', 'TEXT');
    console.log('🔧 Migración SQLite completada (folio, fechaInicio, habilidades)');
  } catch (e) {
    console.error('❌ Error migrando columnas SQLite:', e.message);
  }
}

async function migratePostgres() {
  // Preferir DATABASE_URL; si no, construir desde PG*
  if (!Pool) {
    // Cargar 'pg' solo cuando realmente se use Postgres
    ({ Pool } = require('pg'));
  }
  const connectionString = process.env.DATABASE_URL || undefined;
  pgPool = new Pool(
    connectionString
      ? { connectionString, ssl: { rejectUnauthorized: false } }
      : {
          host: process.env.PGHOST,
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE,
          port: Number(process.env.PGPORT || 5432),
          ssl: { rejectUnauthorized: false },
        }
  );
  console.log('✅ Conectado a Postgres');

  // Crear tabla si no existe
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS vacantes (
      id SERIAL PRIMARY KEY,
      folio VARCHAR(50),
      nombre VARCHAR(255),
      area VARCHAR(255),
      requisitor VARCHAR(255),
      tipoProceso VARCHAR(255),
      tipo VARCHAR(255),
      prioridad VARCHAR(50),
      fechaInicio DATE,
      comentarios TEXT,
      estatus VARCHAR(100),
      habilidades JSONB,
      terna JSONB
    );
  `);
  // Asegurar columna 'terna' si tabla ya existía
  await pgPool.query(`ALTER TABLE vacantes ADD COLUMN IF NOT EXISTS terna JSONB;`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_vacantes_id_desc ON vacantes (id DESC);`);
  console.log('🔧 Migración Postgres completada');

  // Sincronizar secuencia de ID con el máximo existente para evitar reutilización
  try {
    await pgPool.query(`SELECT setval(pg_get_serial_sequence('vacantes','id'), COALESCE((SELECT MAX(id) FROM vacantes), 0))`);
    console.log('🔩 Secuencia de vacantes.id sincronizada con MAX(id)');
  } catch (e) {
    console.warn('⚠️ No se pudo sincronizar la secuencia de vacantes.id:', e.message);
  }
}

(async () => {
  try {
    if (USE_PG) {
      await migratePostgres();
    } else {
      await migrateSQLite();
    }
  } catch (e) {
    console.error('❌ Error inicializando base de datos:', e.message);
  }
})();

// Helpers
const pad4 = n => n.toString().padStart(4, '0');
function hoyYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}
function hoyISODate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ===============================
// 📥 OBTENER TODAS LAS VACANTES
// ===============================
app.get('/api/vacantes', async (req, res) => {
  try {
    if (USE_PG) {
      const { rows } = await pgPool.query(
        `SELECT id, folio, nombre, area, requisitor, tipoProceso, tipo, prioridad, fechaInicio, comentarios, estatus, habilidades, terna
         FROM vacantes
         ORDER BY id DESC`
      );
      const mapped = rows.map(r => ({
        ...r,
        habilidades: r.habilidades || null,
        terna: r.terna || null,
        fechaInicio: r.fechainicio || r.fechaInicio || r.fecha || null
      }));
      return res.json(mapped);
    }
    db.all(`SELECT id, folio, nombre, area, requisitor, tipoProceso, tipo, prioridad, fechaInicio, comentarios, estatus, habilidades, terna
            FROM vacantes
            ORDER BY id DESC`, [], (err, rows) => {
      if (err) {
        console.error('❌ Error al listar vacantes:', err.message);
        return res.status(500).json({ error: 'Error al listar vacantes' });
      }
      const rowsConHabilidades = rows.map(row => ({
        ...row,
        habilidades: row.habilidades ? JSON.parse(row.habilidades) : null,
        terna: row.terna ? JSON.parse(row.terna) : null
      }));
      res.json(rowsConHabilidades);
    });
  } catch (e) {
    console.error('❌ Error al listar vacantes (PG):', e.message);
    res.status(500).json({ error: 'Error al listar vacantes' });
  }
});

// ===============================
// 🔍 OBTENER UNA VACANTE POR ID (⭐ NUEVO)
// ===============================
app.get('/api/vacantes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (USE_PG) {
      const { rows } = await pgPool.query(
        `SELECT id, folio, nombre, area, requisitor, tipoProceso, tipo, prioridad, fechaInicio, comentarios, estatus, habilidades, terna
         FROM vacantes WHERE id = $1`, [id]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: 'Vacante no encontrada' });
      return res.json({ ...row, habilidades: row.habilidades || null, terna: row.terna || null });
    }
    db.get(`SELECT id, folio, nombre, area, requisitor, tipoProceso, tipo, prioridad, fechaInicio, comentarios, estatus, habilidades, terna
            FROM vacantes
            WHERE id = ?`, [id], (err, row) => {
      if (err) {
        console.error('❌ Error al obtener vacante:', err.message);
        return res.status(500).json({ error: 'Error al obtener vacante' });
      }
      if (!row) return res.status(404).json({ error: 'Vacante no encontrada' });
      const vacanteConHabilidades = {
        ...row,
        habilidades: row.habilidades ? JSON.parse(row.habilidades) : null,
        terna: row.terna ? JSON.parse(row.terna) : null
      };
      console.log(`📄 Vacante ${id} recuperada correctamente`);
      res.json(vacanteConHabilidades);
    });
  } catch (e) {
    console.error('❌ Error al obtener vacante (PG):', e.message);
    res.status(500).json({ error: 'Error al obtener vacante' });
  }
});

// ===============================
// 📨 CREAR VACANTE
// ===============================
app.post('/api/vacantes', async (req, res) => {
  const { nombre, area, requisitor, tipoProceso, tipo, prioridad, comentarios, fechaIngreso } = req.body;

  const estatus = 'Cargar Descripción de Puesto';
  const fechaInicio = (typeof fechaIngreso === 'string' && fechaIngreso.length >= 10)
    ? fechaIngreso.slice(0, 10)
    : hoyISODate();
  const habilidadesJSON = null;
  const ternaJSON = null;

  try {
    if (USE_PG) {
      const insertRes = await pgPool.query(
        `INSERT INTO vacantes (nombre, area, requisitor, tipoProceso, tipo, prioridad, fechaInicio, comentarios, estatus, habilidades, terna)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [nombre||'', area||'', requisitor||'', tipoProceso||'', tipo||'', prioridad||'', fechaInicio, comentarios||'', estatus, habilidadesJSON, ternaJSON]
      );
      const id = insertRes.rows[0].id;
      const folio = `PL-${hoyYYYYMMDD()}-${pad4(id)}`;
      await pgPool.query(`UPDATE vacantes SET folio = $1 WHERE id = $2`, [folio, id]);
      console.log(`✅ Vacante guardada (PG) con ID ${id} y folio ${folio}`);
      return res.json({ id, folio, fechaInicio });
    }

    // SQLite
    const sqlInsert = `
      INSERT INTO vacantes (nombre, area, requisitor, tipoProceso, tipo, prioridad, fecha, comentarios, estatus, fechaInicio, habilidades, terna)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(sqlInsert, [
      nombre || '', area || '', requisitor || '', tipoProceso || '', tipo || '', prioridad || '', null, comentarios || '', estatus, fechaInicio, habilidadesJSON, ternaJSON
    ], function (err) {
      if (err) {
        console.error('❌ Error al guardar la vacante:', err.message);
        return res.status(500).json({ error: 'Error al guardar la vacante' });
      }
      const id = this.lastID;
      const folio = `PL-${hoyYYYYMMDD()}-${pad4(id)}`;
      db.run(`UPDATE vacantes SET folio = ? WHERE id = ?`, [folio, id], function (err2) {
        if (err2) {
          console.error('❌ Error al actualizar folio:', err2.message);
          return res.json({ id, folio: null, fechaInicio });
        }
        console.log(`✅ Vacante guardada con ID ${id} y folio ${folio}`);
        res.json({ id, folio, fechaInicio });
      });
    });
  } catch (e) {
    console.error('❌ Error al guardar la vacante (PG):', e.message);
    res.status(500).json({ error: 'Error al guardar la vacante' });
  }
});

// ===============================
// ✏️ ACTUALIZAR VACANTE
// ===============================
app.put('/api/vacantes/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, area, requisitor, tipoProceso, tipo, prioridad, comentarios, estatus, habilidades, terna } = req.body;
  const habilidadesJSON = habilidades ? JSON.stringify(habilidades) : null;
  const ternaJSON = terna ? JSON.stringify(terna) : null;

  try {
    if (USE_PG) {
      const upd = await pgPool.query(
        `UPDATE vacantes SET nombre=$1, area=$2, requisitor=$3, tipoProceso=$4, tipo=$5, prioridad=$6, comentarios=$7, estatus=$8, habilidades=$9, terna=$10 WHERE id=$11 RETURNING *`,
        [nombre, area, requisitor, tipoProceso, tipo, prioridad, comentarios, estatus, habilidadesJSON, ternaJSON, id]
      );
      if (upd.rowCount === 0) return res.status(404).json({ error: 'Vacante no encontrada' });
      const row = upd.rows[0];
      return res.json({ ...row, habilidades: row.habilidades || null });
    }
    const sql = `
      UPDATE vacantes
      SET nombre = ?, area = ?, requisitor = ?, tipoProceso = ?, tipo = ?, prioridad = ?, comentarios = ?, estatus = ?, habilidades = ?, terna = ?
      WHERE id = ?
    `;
    db.run(sql, [nombre, area, requisitor, tipoProceso, tipo, prioridad, comentarios, estatus, habilidadesJSON, ternaJSON, id], function (err) {
      if (err) {
        console.error('❌ Error al actualizar la vacante:', err.message);
        return res.status(500).json({ error: 'Error al actualizar la vacante' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Vacante no encontrada' });
      }
      console.log(`✏️ Vacante con ID ${id} actualizada correctamente`);
      db.get(`SELECT * FROM vacantes WHERE id = ?`, [id], (err2, row) => {
        if (err2 || !row) {
          return res.json({ message: 'Vacante actualizada correctamente' });
        }
        res.json({
          ...row,
          habilidades: row.habilidades ? JSON.parse(row.habilidades) : null,
          terna: row.terna ? JSON.parse(row.terna) : null
        });
      });
    });
  } catch (e) {
    console.error('❌ Error al actualizar la vacante (PG):', e.message);
    res.status(500).json({ error: 'Error al actualizar la vacante' });
  }
});

// ===============================
// 🗑️ ELIMINAR VACANTE
// ===============================
app.delete('/api/vacantes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (USE_PG) {
      const del = await pgPool.query('DELETE FROM vacantes WHERE id = $1', [id]);
      if (del.rowCount === 0) return res.status(404).json({ error: 'Vacante no encontrada' });
      console.log(`🗑️ Vacante con ID ${id} eliminada (PG)`);
      return res.json({ message: 'Vacante eliminada correctamente' });
    }
    const sql = 'DELETE FROM vacantes WHERE id = ?';
    db.run(sql, id, function (err) {
      if (err) {
        console.error('❌ Error al eliminar la vacante:', err.message);
        return res.status(500).json({ error: 'Error al eliminar la vacante' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Vacante no encontrada' });
      }
      console.log(`🗑️ Vacante con ID ${id} eliminada`);
      res.json({ message: 'Vacante eliminada correctamente' });
    });
  } catch (e) {
    console.error('❌ Error al eliminar la vacante (PG):', e.message);
    res.status(500).json({ error: 'Error al eliminar la vacante' });
  }
});

// ===============================
// 🚀 INICIAR SERVIDOR
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});


