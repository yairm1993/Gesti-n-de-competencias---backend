// 📂 database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 📌 Ruta a la base de datos (se guardará en backend/competencias.db)
const dbPath = path.resolve(__dirname, 'competencias.db');
const db = new sqlite3.Database(dbPath);

// 🧱 Crear tablas si no existen
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS vacantes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre_vacante TEXT NOT NULL,
      requisitor TEXT,
      tipo_contratacion TEXT,
      prioridad TEXT,
      comentarios TEXT,
      estatus TEXT DEFAULT 'Por iniciar',
      fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS habilidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vacante_id INTEGER,
      tipo TEXT,
      habilidad TEXT,
      FOREIGN KEY (vacante_id) REFERENCES vacantes(id)
    )
  `);
});

module.exports = db;
