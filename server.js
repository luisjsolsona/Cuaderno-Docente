const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cuaderno_secret_change_in_prod';

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/cuaderno.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Base schema (fresh install)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'docente',
    display_name TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cuadernos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT DEFAULT 'Mi Cuaderno',
    state_json TEXT DEFAULT '{}',
    calendar_json TEXT DEFAULT '[]',
    plan_json TEXT DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Migrations for existing databases
(function migrate() {
  // Add plan_json column if missing
  try { db.exec("ALTER TABLE cuadernos ADD COLUMN plan_json TEXT DEFAULT '{}'"); } catch {}

  // Remove UNIQUE constraint on user_id if present (allows multiple cuadernos per user)
  const indexes = db.pragma("index_list('cuadernos')");
  const hasUniqueUserId = indexes.some(idx => {
    if (!idx.unique) return false;
    return db.pragma(`index_info('${idx.name}')`).some(c => c.name === 'user_id');
  });
  if (hasUniqueUserId) {
    db.exec(`
      ALTER TABLE cuadernos RENAME TO cuadernos_v1;
      CREATE TABLE cuadernos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT DEFAULT 'Mi Cuaderno',
        state_json TEXT DEFAULT '{}',
        calendar_json TEXT DEFAULT '[]',
        plan_json TEXT DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO cuadernos (id, user_id, title, state_json, calendar_json, plan_json, updated_at, created_at)
        SELECT id, user_id, title, state_json, calendar_json, plan_json, updated_at, created_at FROM cuadernos_v1;
      DROP TABLE cuadernos_v1;
    `);
  }
})();

// Seed admin
const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
if (!adminExists) {
  db.prepare("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)").run(
    'admin', bcrypt.hashSync('admin123', 10), 'admin', 'Administrador'
  );
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido o expirado' }); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

function parseCuaderno(c) {
  try {
    return {
      ...c,
      state_json:    JSON.parse(c.state_json    || '{}'),
      calendar_json: JSON.parse(c.calendar_json || '[]'),
      plan_json:     JSON.parse(c.plan_json     || '{}'),
    };
  } catch {
    return { ...c, state_json: {}, calendar_json: [], plan_json: {} };
  }
}

// === AUTH ===
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Datos incompletos' });
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username).trim());
  if (!user || !bcrypt.compareSync(String(password), user.password))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
    JWT_SECRET, { expiresIn: '14d' }
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name } });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare("SELECT id, username, role, display_name, created_at FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  res.json(user);
});

app.put('/api/me/password', auth, (req, res) => {
  const { current, nuevo } = req.body || {};
  if (!current || !nuevo || nuevo.length < 4) return res.status(400).json({ error: 'Contraseña mínimo 4 caracteres' });
  const user = db.prepare("SELECT password FROM users WHERE id = ?").get(req.user.id);
  if (!bcrypt.compareSync(String(current), user.password)) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(bcrypt.hashSync(String(nuevo), 10), req.user.id);
  res.json({ ok: true });
});

// === USERS (admin) ===
app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(db.prepare("SELECT id, username, role, display_name, created_at FROM users ORDER BY role DESC, display_name").all());
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, display_name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  if (String(password).length < 4) return res.status(400).json({ error: 'Contraseña mínimo 4 caracteres' });
  try {
    const uname = String(username).trim(), dname = String(display_name || username).trim();
    const r = db.prepare("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, 'docente', ?)").run(
      uname, bcrypt.hashSync(String(password), 10), dname
    );
    res.json({ id: r.lastInsertRowid, username: uname, role: 'docente', display_name: dname });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { display_name, password } = req.body || {};
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(id)) return res.status(404).json({ error: 'No encontrado' });
  if (password && String(password).length >= 4)
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(bcrypt.hashSync(String(password), 10), id);
  if (display_name && String(display_name).trim())
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(String(display_name).trim(), id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(id)) return res.status(404).json({ error: 'No encontrado' });
  db.prepare("DELETE FROM cuadernos WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

// === MIS CUADERNOS ===
app.get('/api/mis-cuadernos', auth, (req, res) => {
  const list = db.prepare(`
    SELECT id, title, updated_at, created_at,
      CASE WHEN state_json != '{}' AND state_json != '' THEN 1 ELSE 0 END as has_state,
      CASE WHEN calendar_json != '[]' AND calendar_json != '' THEN 1 ELSE 0 END as has_calendar,
      CASE WHEN plan_json != '{}' AND plan_json != '' THEN 1 ELSE 0 END as has_plan
    FROM cuadernos WHERE user_id = ? ORDER BY updated_at DESC
  `).all(req.user.id);
  res.json(list);
});

app.post('/api/cuaderno', auth, (req, res) => {
  const { title } = req.body || {};
  const t = String(title || 'Nuevo cuaderno').trim();
  const r = db.prepare("INSERT INTO cuadernos (user_id, title) VALUES (?, ?)").run(req.user.id, t);
  res.json({ id: r.lastInsertRowid, title: t });
});

// Auto-cuaderno: GET/PUT without ID (gets/creates the user's single cuaderno)
app.get('/api/cuaderno', auth, (req, res) => {
  let c = db.prepare("SELECT * FROM cuadernos WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1").get(req.user.id);
  if (!c) {
    const r = db.prepare("INSERT INTO cuadernos (user_id, title) VALUES (?, ?)").run(req.user.id, 'Mi Cuaderno');
    c = db.prepare("SELECT * FROM cuadernos WHERE id = ?").get(r.lastInsertRowid);
  }
  res.json(parseCuaderno(c));
});

app.put('/api/cuaderno', auth, (req, res) => {
  let c = db.prepare("SELECT id FROM cuadernos WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1").get(req.user.id);
  if (!c) {
    const r = db.prepare("INSERT INTO cuadernos (user_id, title) VALUES (?, ?)").run(req.user.id, 'Mi Cuaderno');
    c = { id: r.lastInsertRowid };
  }
  const { title, state_json, calendar_json, plan_json } = req.body || {};
  db.prepare(`UPDATE cuadernos SET
    title = COALESCE(?, title),
    state_json = ?,
    calendar_json = ?,
    plan_json = ?,
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(
    title ? String(title).trim() : null,
    JSON.stringify(state_json || {}),
    JSON.stringify(calendar_json || []),
    JSON.stringify(plan_json || {}),
    c.id
  );
  res.json({ ok: true });
});

app.get('/api/cuaderno/:id', auth, (req, res) => {
  const c = db.prepare("SELECT c.*, u.display_name FROM cuadernos c JOIN users u ON c.user_id = u.id WHERE c.id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  if (c.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permiso' });
  res.json(parseCuaderno(c));
});

app.put('/api/cuaderno/:id', auth, (req, res) => {
  const c = db.prepare("SELECT user_id FROM cuadernos WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  if (c.user_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
  const { title, state_json, calendar_json, plan_json } = req.body || {};
  db.prepare(`UPDATE cuadernos SET
    title = COALESCE(?, title),
    state_json = ?,
    calendar_json = ?,
    plan_json = ?,
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(
    title ? String(title).trim() : null,
    JSON.stringify(state_json || {}),
    JSON.stringify(calendar_json || []),
    JSON.stringify(plan_json || {}),
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/cuaderno/:id', auth, (req, res) => {
  const c = db.prepare("SELECT user_id FROM cuadernos WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  if (c.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permiso' });
  db.prepare("DELETE FROM cuadernos WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// === ADMIN: all cuadernos ===
app.get('/api/cuadernos', auth, adminOnly, (req, res) => {
  res.json(db.prepare(`
    SELECT c.id, c.title, c.updated_at, c.created_at,
           u.id as user_id, u.username, u.display_name,
           CASE WHEN c.state_json != '{}' AND c.state_json != '' THEN 1 ELSE 0 END as has_state,
           CASE WHEN c.calendar_json != '[]' AND c.calendar_json != '' THEN 1 ELSE 0 END as has_calendar
    FROM cuadernos c JOIN users u ON c.user_id = u.id
    ORDER BY u.display_name, c.updated_at DESC
  `).all());
});

app.get('/api/cuadernos/:id', auth, adminOnly, (req, res) => {
  const c = db.prepare("SELECT c.*, u.username, u.display_name FROM cuadernos c JOIN users u ON c.user_id = u.id WHERE c.id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  res.json(parseCuaderno(c));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Cuaderno Docente en puerto ${PORT}`));
