// ===============================
// 📦 DEPENDENCIAS
// ===============================
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // ✅ Puerto dinámico para Render

// ===============================
// 🧰 MIDDLEWARE
// ===============================
app.use(cors());
app.use(express.json());

// ✅ Servir frontend (por si decides desplegar todo junto en un futuro)
app.use(express.static(path.join(__dirname, '..', 'Frontend')));

// ===============================
// 📊 BASE DE DATOS
// ===============================
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error al conectar con la base de datos:', err.message);
  } else {
    console.log('✅ Conectado a la base de datos SQLite');
  }
});

// Crear tabla si no existe
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

// ===============================
// 📥 OBTENER TODAS LAS VACANTES
// ===============================
app.get('/api/vacantes', (req, res) => {
  db.all('SELECT * FROM vacantes ORDER BY id DESC', [], (err, rows) => {
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
  const { nombre, area, requisitor, tipoProceso, tipo, prioridad, fecha, comentarios, estatus } = req.body;

  const sql = `
    INSERT INTO vacantes (nombre, area, requisitor, tipoProceso, tipo, prioridad, fecha, comentarios, estatus)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(sql, [nombre, area, requisitor, tipoProceso, tipo, prioridad, fecha, comentarios, estatus], function (err) {
    if (err) {
      console.error('❌ Error al guardar la vacante:', err.message);
      return res.status(500).json({ error: 'Error al guardar la vacante' });
    }
    console.log(`✅ Vacante guardada con ID ${this.lastID}`);
    res.json({ id: this.lastID });
  });
});

// ===============================
// ✏️ ACTUALIZAR VACANTE
// ===============================
app.put('/api/vacantes/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, area, requisitor, tipoProceso, tipo, prioridad, fecha, comentarios, estatus } = req.body;

  const sql = `
    UPDATE vacantes
    SET nombre = ?, area = ?, requisitor = ?, tipoProceso = ?, tipo = ?, prioridad = ?, fecha = ?, comentarios = ?, estatus = ?
    WHERE id = ?
  `;

  db.run(sql, [nombre, area, requisitor, tipoProceso, tipo, prioridad, fecha, comentarios, estatus, id], function (err) {
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
// 🏠 RUTA RAÍZ
// ===============================
app.get('/', (req, res) => {
  res.send('✅ Servidor PlayLearn Backend activo y funcionando');
});

// ===============================
// 🚀 INICIAR SERVIDOR
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
