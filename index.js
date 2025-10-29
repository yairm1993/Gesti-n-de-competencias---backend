// ===============================
// 📦 DEPENDENCIAS
// ===============================
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// 🧰 MIDDLEWARE
// ===============================
app.use(cors());
app.use(express.json());

// Servir estáticos del Frontend si lo necesitas local
app.use(express.static(path.join(__dirname, '..', 'Frontend')));

app.get('/', (req, res) => {
  // Si estás sirviendo frontend local:
  // res.sendFile(path.join(__dirname, '..', 'Frontend', 'index.html'));
  res.send('✅ Servidor activo y funcionando correctamente');
});

// ===============================
// 📊 BASE DE DATOS
// ===============================
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
  if (err) {
    console.error('❌ Error al conectar con la base de datos:', err.message);
  } else {
    console.log('✅ Conectado a la base de datos SQLite');
  }
});

// Crear tabla si no existe (sin nuevas columnas aún)
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

// ➕ Migración segura de columnas nuevas: folio y fechaInicio
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

(async () => {
  try {
    await ensureColumn('vacantes', 'folio', 'TEXT');
    await ensureColumn('vacantes', 'fechaInicio', 'TEXT');
    console.log('🔧 Migración de columnas completada (folio, fechaInicio)');
  } catch (e) {
    console.error('❌ Error migrando columnas:', e.message);
  }
})();

// Helpers
const pad4 = n => n.toString().padStart(4, '0');
function hoyYYYYMMDD() {
  // Fecha local de MX (si Render está en UTC, igual guardamos ISO simple)
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
app.get('/api/vacantes', (req, res) => {
  db.all(`SELECT id, folio, nombre, area, requisitor, tipoProceso, tipo, prioridad, fechaInicio, comentarios, estatus
          FROM vacantes
          ORDER BY id DESC`, [], (err, rows) => {
    if (err) {
      console.error('❌ Error al listar vacantes:', err.message);
      return res.status(500).json({ error: 'Error al listar vacantes' });
    }
    res.json(rows);
  });
});

// ===============================
// 📨 CREAR VACANTE
// ===============================
app.post('/api/vacantes', (req, res) => {
  const { nombre, area, requisitor, tipoProceso, tipo, prioridad, comentarios } = req.body;

  // estatus inicial (mantiene compatibilidad)
  const estatus = 'Cargar Descripción de Puesto';
  // fechaInicio se fija automáticamente hoy
  const fechaInicio = hoyISODate();

  // Insertamos primero sin folio para recuperar el id
  const sqlInsert = `
    INSERT INTO vacantes (nombre, area, requisitor, tipoProceso, tipo, prioridad, fecha, comentarios, estatus, fechaInicio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(sqlInsert, [
    nombre || '',
    area || '',
    requisitor || '',
    tipoProceso || '',
    tipo || '',
    prioridad || '',
    null,                  // 'fecha' antiguo, ya no lo usamos, lo dejamos null
    comentarios || '',
    estatus,
    fechaInicio
  ], function (err) {
    if (err) {
      console.error('❌ Error al guardar la vacante:', err.message);
      return res.status(500).json({ error: 'Error al guardar la vacante' });
    }

    const id = this.lastID;
    const folio = `PL-${hoyYYYYMMDD()}-${pad4(id)}`;

    // Actualizamos el folio en la fila recién creada
    db.run(`UPDATE vacantes SET folio = ? WHERE id = ?`, [folio, id], function (err2) {
      if (err2) {
        console.error('❌ Error al actualizar folio:', err2.message);
        // Aun así devolvemos el id para no romper el flujo
        return res.json({ id, folio: null, fechaInicio });
      }
      console.log(`✅ Vacante guardada con ID ${id} y folio ${folio}`);
      res.json({ id, folio, fechaInicio });
    });
  });
});

// ===============================
// ✏️ ACTUALIZAR VACANTE
// ===============================
app.put('/api/vacantes/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, area, requisitor, tipoProceso, tipo, prioridad, comentarios, estatus } = req.body;

  const sql = `
    UPDATE vacantes
    SET nombre = ?, area = ?, requisitor = ?, tipoProceso = ?, tipo = ?, prioridad = ?, comentarios = ?, estatus = ?
    WHERE id = ?
  `;

  db.run(sql, [nombre, area, requisitor, tipoProceso, tipo, prioridad, comentarios, estatus, id], function (err) {
    if (err) {
      console.error('❌ Error al actualizar la vacante:', err.message);
      return res.status(500).json({ error: 'Error al actualizar la vacante' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Vacante no encontrada' });
    }
    console.log(`✏️ Vacante con ID ${id} actualizada`);
    res.json({ message: 'Vacante actualizada correctamente' });
  });
});

// ===============================
// 🗑️ ELIMINAR VACANTE
// ===============================
app.delete('/api/vacantes/:id', (req, res) => {
  const { id } = req.params;
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
});

// ===============================
// 🚀 INICIAR SERVIDOR
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
