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
    ciclo TEXT DEFAULT '',
    state_json TEXT DEFAULT '{}',
    calendar_json TEXT DEFAULT '[]',
    plan_json TEXT DEFAULT '{}',
    seguimiento_json TEXT DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS catedu_cache (
    url TEXT PRIMARY KEY,
    html TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS temporalizaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    curso TEXT DEFAULT '',
    nivel TEXT DEFAULT '',
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_by TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations for existing databases
(function migrate() {
  try { db.exec("ALTER TABLE cuadernos ADD COLUMN plan_json TEXT DEFAULT '{}'"); } catch {}
  try { db.exec("ALTER TABLE cuadernos ADD COLUMN ciclo TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE cuadernos ADD COLUMN seguimiento_json TEXT DEFAULT '{}'"); } catch {}
  // temporalizaciones: el ámbito pasa de "ciclo" a "nivel" (CFGB/CFGM/CFGS/CE), porque la FEOE es común por nivel
  try {
    db.exec("ALTER TABLE temporalizaciones ADD COLUMN nivel TEXT DEFAULT ''");
    const cols = db.pragma("table_info('temporalizaciones')").map(c => c.name);
    if (cols.includes('ciclo')) {
      db.exec(`UPDATE temporalizaciones SET nivel = CASE
        WHEN upper(ciclo) LIKE '%CFGB%' OR upper(ciclo) LIKE '%FPB%' OR lower(ciclo) LIKE '%bási%' OR lower(ciclo) LIKE '%basi%' THEN 'CFGB'
        WHEN upper(ciclo) LIKE '%CFGS%' OR lower(ciclo) LIKE '%superior%' THEN 'CFGS'
        WHEN upper(ciclo) LIKE '%CFGM%' OR lower(ciclo) LIKE '%medio%' THEN 'CFGM'
        ELSE '' END WHERE nivel = ''`);
    }
  } catch {}

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
        ciclo TEXT DEFAULT '',
        state_json TEXT DEFAULT '{}',
        calendar_json TEXT DEFAULT '[]',
        plan_json TEXT DEFAULT '{}',
        seguimiento_json TEXT DEFAULT '{}',
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

function isPrivileged(user) {
  return user.role === 'admin' || user.role === 'jefatura';
}

function adminOnly(req, res, next) {
  if (!isPrivileged(req.user)) return res.status(403).json({ error: 'Solo administradores o jefatura' });
  next();
}

function parseCuaderno(c) {
  try {
    return {
      ...c,
      state_json:       JSON.parse(c.state_json       || '{}'),
      calendar_json:    JSON.parse(c.calendar_json    || '[]'),
      plan_json:        JSON.parse(c.plan_json        || '{}'),
      seguimiento_json: JSON.parse(c.seguimiento_json || '{}'),
    };
  } catch {
    return { ...c, state_json: {}, calendar_json: [], plan_json: {}, seguimiento_json: {} };
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

// === USERS (admin/jefatura) ===
app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(db.prepare("SELECT id, username, role, display_name, created_at FROM users ORDER BY role DESC, display_name").all());
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, display_name, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  if (String(password).length < 4) return res.status(400).json({ error: 'Contraseña mínimo 4 caracteres' });
  const allowedRoles = ['docente', 'jefatura'];
  const assignedRole = allowedRoles.includes(role) ? role : 'docente';
  try {
    const uname = String(username).trim(), dname = String(display_name || username).trim();
    const r = db.prepare("INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)").run(
      uname, bcrypt.hashSync(String(password), 10), assignedRole, dname
    );
    res.json({ id: r.lastInsertRowid, username: uname, role: assignedRole, display_name: dname });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { display_name, password, role } = req.body || {};
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(id)) return res.status(404).json({ error: 'No encontrado' });
  if (password && String(password).length >= 4)
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(bcrypt.hashSync(String(password), 10), id);
  if (display_name && String(display_name).trim())
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(String(display_name).trim(), id);
  const allowedRoles = ['docente', 'jefatura'];
  if (role && allowedRoles.includes(role))
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
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
    SELECT id, title, ciclo, updated_at, created_at,
      CASE WHEN state_json != '{}' AND state_json != '' THEN 1 ELSE 0 END as has_state,
      CASE WHEN calendar_json != '[]' AND calendar_json != '' THEN 1 ELSE 0 END as has_calendar,
      CASE WHEN (plan_json != '{}' AND plan_json != '') OR state_json LIKE '%"lastAsignaciones":[{%' THEN 1 ELSE 0 END as has_plan
    FROM cuadernos WHERE user_id = ? ORDER BY ciclo, updated_at DESC
  `).all(req.user.id);
  res.json(list);
});

// Cuadernos de otros docentes: solo admin/jefatura (los docentes ven únicamente los suyos)
app.get('/api/otros-cuadernos', auth, (req, res) => {
  if (!isPrivileged(req.user)) return res.json([]);
  const list = db.prepare(`
    SELECT c.id, c.title, c.ciclo, c.updated_at, c.created_at,
      u.id as owner_id, u.display_name as owner_name, u.username as owner_username,
      CASE WHEN c.state_json != '{}' AND c.state_json != '' THEN 1 ELSE 0 END as has_state,
      CASE WHEN c.calendar_json != '[]' AND c.calendar_json != '' THEN 1 ELSE 0 END as has_calendar
    FROM cuadernos c JOIN users u ON c.user_id = u.id
    WHERE c.user_id != ? AND u.role NOT IN ('admin')
    ORDER BY c.ciclo, u.display_name, c.updated_at DESC
  `).all(req.user.id);
  res.json(list);
});

// Crear cuaderno. Admin/jefatura pueden crearlo para otro docente (user_id) y con una temporalización de centro ya aplicada (temporalizacion_id)
app.post('/api/cuaderno', auth, (req, res) => {
  const { title, ciclo, user_id, temporalizacion_id, ras, modulo_nombre } = req.body || {};
  const t = String(title || 'Nuevo cuaderno').trim();
  const c = String(ciclo || '').trim();
  let owner = req.user.id;
  if (user_id !== undefined && Number(user_id) !== req.user.id) {
    if (!isPrivileged(req.user)) return res.status(403).json({ error: 'Solo jefatura puede crear cuadernos para otros docentes' });
    if (!db.prepare("SELECT id FROM users WHERE id = ?").get(Number(user_id))) return res.status(404).json({ error: 'Docente no encontrado' });
    owner = Number(user_id);
  }
  let state = {};
  if (temporalizacion_id) {
    const all = db.prepare("SELECT * FROM temporalizaciones").all().map(parseTemporalizacion);
    const tc = all.find(x => x.id === Number(temporalizacion_id));
    if (!tc) return res.status(404).json({ error: 'Temporalización no encontrada' });
    state = estadoDesdeTemporalizacion(tc, all);
  }
  // RAs y módulo elegidos por jefatura en CATEDU (el horario lo pone el docente)
  if (Array.isArray(ras) && ras.length) {
    if (ras.length > 50) return res.status(400).json({ error: 'Demasiados RAs' });
    state.RAs = ras.filter(r => r && typeof r === 'object').map(r => ({ ...r, ces: Array.isArray(r.ces) ? r.ces : [] }));
  }
  if (modulo_nombre) state.moduloNombre = String(modulo_nombre).slice(0, 120);
  const r = db.prepare("INSERT INTO cuadernos (user_id, title, ciclo, state_json) VALUES (?, ?, ?, ?)").run(owner, t, c, JSON.stringify(state));
  res.json({ id: r.lastInsertRowid, title: t, ciclo: c, user_id: owner });
});

// Duplicar cuaderno
app.post('/api/cuaderno/:id/duplicar', auth, (req, res) => {
  const src = db.prepare("SELECT * FROM cuadernos WHERE id = ?").get(req.params.id);
  if (!src) return res.status(404).json({ error: 'No encontrado' });
  if (src.user_id !== req.user.id && !isPrivileged(req.user))
    return res.status(403).json({ error: 'Sin permiso' });
  const newTitle = `Copia de ${src.title || 'Mi Cuaderno'}`;
  const r = db.prepare(
    "INSERT INTO cuadernos (user_id, title, ciclo, state_json, calendar_json, plan_json, seguimiento_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(req.user.id, newTitle, src.ciclo || '', src.state_json || '{}', src.calendar_json || '[]', src.plan_json || '{}', src.seguimiento_json || '{}');
  res.json({ id: r.lastInsertRowid, title: newTitle });
});

// Auto-cuaderno: GET/PUT without ID (admin backward compat)
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
  const { title, ciclo, state_json, calendar_json, plan_json, seguimiento_json } = req.body || {};
  db.prepare(`UPDATE cuadernos SET
    title = COALESCE(?, title),
    ciclo = COALESCE(?, ciclo),
    state_json = ?,
    calendar_json = ?,
    plan_json = ?,
    seguimiento_json = ?,
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(
    title ? String(title).trim() : null,
    ciclo !== undefined ? String(ciclo || '') : null,
    JSON.stringify(state_json || {}),
    JSON.stringify(calendar_json || []),
    JSON.stringify(plan_json || {}),
    JSON.stringify(seguimiento_json || {}),
    c.id
  );
  res.json({ ok: true });
});

// Leer un cuaderno: propietario o admin/jefatura
app.get('/api/cuaderno/:id', auth, (req, res) => {
  const c = db.prepare("SELECT c.*, u.display_name, u.id as owner_id FROM cuadernos c JOIN users u ON c.user_id = u.id WHERE c.id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  if (c.user_id !== req.user.id && !isPrivileged(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  res.json(parseCuaderno(c));
});

app.put('/api/cuaderno/:id', auth, (req, res) => {
  const c = db.prepare("SELECT user_id FROM cuadernos WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  if (c.user_id !== req.user.id && !isPrivileged(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const { title, ciclo, state_json, calendar_json, plan_json, seguimiento_json } = req.body || {};
  db.prepare(`UPDATE cuadernos SET
    title = COALESCE(?, title),
    ciclo = COALESCE(?, ciclo),
    state_json = ?,
    calendar_json = ?,
    plan_json = ?,
    seguimiento_json = ?,
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(
    title ? String(title).trim() : null,
    ciclo !== undefined ? String(ciclo || '') : null,
    JSON.stringify(state_json || {}),
    JSON.stringify(calendar_json || []),
    JSON.stringify(plan_json || {}),
    JSON.stringify(seguimiento_json || {}),
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/cuaderno/:id', auth, (req, res) => {
  const c = db.prepare("SELECT user_id FROM cuadernos WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  if (c.user_id !== req.user.id && !isPrivileged(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  db.prepare("DELETE FROM cuadernos WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Actualizar solo el seguimiento de un cuaderno (admin/jefatura o propietario)
app.patch('/api/cuaderno/:id/seguimiento', auth, (req, res) => {
  const c = db.prepare("SELECT user_id FROM cuadernos WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  if (c.user_id !== req.user.id && !isPrivileged(req.user)) return res.status(403).json({ error: 'Sin permiso' });
  const { seguimiento_json } = req.body || {};
  db.prepare("UPDATE cuadernos SET seguimiento_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(JSON.stringify(seguimiento_json || {}), req.params.id);
  res.json({ ok: true });
});

// === TEMPORALIZACIONES DE CENTRO (fuente única: fechas de curso, festivos, FEOE, evaluaciones) ===
// nivel: '' = general del curso (fechas + festivos, iguales para todos); CFGB/CFGM/CFGS/CE = FEOE y evaluaciones propias del nivel
const NIVELES = ['', 'CFGB', 'CFGM', 'CFGS', 'CE'];
function normalizarNivel(v) { const n = String(v || '').trim().toUpperCase(); return NIVELES.includes(n) ? n : null; }
// Normaliza y valida el JSON recibido; devuelve null si no es válido
function normalizarTemporalizacion(t) {
  if (!t || typeof t !== 'object') return null;
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const iso = v => (typeof v === 'string' && isoRe.test(v)) ? v : '';
  const rangos = arr => (Array.isArray(arr) ? arr : []).map(r => {
    if (!r || typeof r !== 'object') return null;
    let ini = iso(r.inicio), fin = iso(r.fin) || ini;
    if (!ini) return null;
    if (fin < ini) [ini, fin] = [fin, ini];
    return { inicio: ini, fin, desc: String(r.desc ?? r.motivo ?? r.empresa ?? '').slice(0, 200) };
  }).filter(Boolean);
  const out = {
    inicio: iso(t.inicio), fin: iso(t.fin),
    festivos: rangos(t.festivos).map(r => ({ inicio: r.inicio, fin: r.fin, motivo: r.desc })),
    feoes:    rangos(t.feoes).map(r => ({ inicio: r.inicio, fin: r.fin, empresa: r.desc })),
    evaluaciones: (Array.isArray(t.evaluaciones) ? t.evaluaciones : []).map(e => {
      const f = e && iso(e.fecha); if (!f) return null;
      return { fecha: f, desc: String(e.desc || 'Evaluación').slice(0, 200), bloquea: !!e.bloquea };
    }).filter(Boolean)
  };
  if (!out.inicio && !out.fin && !out.festivos.length && !out.feoes.length && !out.evaluaciones.length) return null;
  return out;
}

// Construye el state_json inicial de un cuaderno a partir de una temporalización de centro (hereda de la general del mismo curso)
function estadoDesdeTemporalizacion(t, lista) {
  let base = null;
  if ((t.nivel || '').trim()) {
    const generales = lista.filter(x => !(x.nivel || '').trim());
    base = generales.find(x => (x.curso || '').trim() === (t.curso || '').trim()) || (generales.length === 1 ? generales[0] : null);
  }
  const d = t.data_json || {}, b = base?.data_json || {};
  const dias = (ini, fin) => {
    const out = []; const dI = new Date(ini + 'T00:00:00Z'), dF = new Date((fin || ini) + 'T00:00:00Z');
    for (let x = dI.getTime(); x <= dF.getTime(); x += 86400000) out.push(new Date(x).toISOString().slice(0, 10));
    return out;
  };
  const festivos = new Map(), feoes = new Map(), evaluaciones = new Map();
  [...(b.festivos || []), ...(d.festivos || [])].forEach(r => dias(r.inicio, r.fin).forEach(x => festivos.set(x, r.motivo || '')));
  [...(b.feoes || []), ...(d.feoes || [])].forEach(r => dias(r.inicio, r.fin).forEach(x => feoes.set(x, r.empresa || '')));
  [...(b.evaluaciones || []), ...(d.evaluaciones || [])].forEach(e => evaluaciones.set(e.fecha, { desc: e.desc || 'Evaluación', bloquea: !!e.bloquea }));
  return {
    inicio: d.inicio || b.inicio || '', fin: d.fin || b.fin || '',
    festivos: [...festivos.entries()], feoes: [...feoes.entries()], evaluaciones: [...evaluaciones.entries()],
    modulos: [], RAs: [], planMap: [], lastAsignaciones: [], planSesiones: [], planSesCounts: [], planLocked: [],
    centroTemp: { id: t.id, nombre: t.nombre, updated_at: t.updated_at, baseId: base?.id || null, baseUpdatedAt: base?.updated_at || '' }
  };
}

function parseTemporalizacion(row) {
  let data = {};
  try { data = JSON.parse(row.data_json || '{}'); } catch {}
  return { ...row, data_json: data };
}

// Todos los usuarios autenticados pueden leerlas
app.get('/api/temporalizaciones', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM temporalizaciones ORDER BY curso DESC, nivel, nombre").all().map(parseTemporalizacion));
});

app.get('/api/temporalizaciones/:id', auth, (req, res) => {
  const row = db.prepare("SELECT * FROM temporalizaciones WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  res.json(parseTemporalizacion(row));
});

app.post('/api/temporalizaciones', auth, adminOnly, (req, res) => {
  const { nombre, curso, nivel, data } = req.body || {};
  const n = String(nombre || '').trim();
  if (!n) return res.status(400).json({ error: 'Nombre requerido' });
  const niv = normalizarNivel(nivel);
  if (niv === null) return res.status(400).json({ error: 'Nivel no válido (vacío, CFGB, CFGM, CFGS o CE)' });
  const norm = normalizarTemporalizacion(data);
  if (!norm) return res.status(400).json({ error: 'Temporalización vacía o con formato no válido' });
  const r = db.prepare("INSERT INTO temporalizaciones (nombre, curso, nivel, data_json, updated_by) VALUES (?, ?, ?, ?, ?)")
    .run(n, String(curso || '').trim(), niv, JSON.stringify(norm), req.user.display_name || req.user.username);
  res.json(parseTemporalizacion(db.prepare("SELECT * FROM temporalizaciones WHERE id = ?").get(r.lastInsertRowid)));
});

app.put('/api/temporalizaciones/:id', auth, adminOnly, (req, res) => {
  const row = db.prepare("SELECT * FROM temporalizaciones WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  const { nombre, curso, nivel, data } = req.body || {};
  let niv = null;
  if (nivel !== undefined) { niv = normalizarNivel(nivel); if (niv === null) return res.status(400).json({ error: 'Nivel no válido (vacío, CFGB, CFGM, CFGS o CE)' }); }
  let dataJson = row.data_json, touched = false;
  if (data !== undefined) {
    const norm = normalizarTemporalizacion(data);
    if (!norm) return res.status(400).json({ error: 'Temporalización vacía o con formato no válido' });
    dataJson = JSON.stringify(norm); touched = true;
  }
  db.prepare(`UPDATE temporalizaciones SET
    nombre = COALESCE(?, nombre), curso = COALESCE(?, curso), nivel = COALESCE(?, nivel),
    data_json = ?, updated_by = ?, updated_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE updated_at END
    WHERE id = ?`).run(
    nombre !== undefined ? String(nombre).trim() || null : null,
    curso  !== undefined ? String(curso || '').trim() : null,
    niv,
    dataJson, req.user.display_name || req.user.username, touched ? 1 : 0, row.id);
  res.json(parseTemporalizacion(db.prepare("SELECT * FROM temporalizaciones WHERE id = ?").get(row.id)));
});

app.delete('/api/temporalizaciones/:id', auth, adminOnly, (req, res) => {
  const r = db.prepare("DELETE FROM temporalizaciones WHERE id = ?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ok: true });
});

// === COPIA DE SEGURIDAD COMPLETA (admin/jefatura): usuarios, cuadernos, temporalizaciones ===
app.get('/api/admin/export', auth, adminOnly, (req, res) => {
  const users = db.prepare("SELECT username, password, role, display_name, created_at FROM users").all();
  const cuadernos = db.prepare(`SELECT c.title, c.ciclo, c.state_json, c.calendar_json, c.plan_json, c.seguimiento_json, c.updated_at, c.created_at, u.username
    FROM cuadernos c JOIN users u ON c.user_id = u.id`).all().map(c => ({ ...c,
      state_json: JSON.parse(c.state_json || '{}'), calendar_json: JSON.parse(c.calendar_json || '[]'),
      plan_json: JSON.parse(c.plan_json || '{}'), seguimiento_json: JSON.parse(c.seguimiento_json || '{}') }));
  const temporalizaciones = db.prepare("SELECT nombre, curso, nivel, data_json, updated_by, updated_at, created_at FROM temporalizaciones").all()
    .map(t => ({ ...t, data_json: JSON.parse(t.data_json || '{}') }));
  res.setHeader('Content-Disposition', `attachment; filename="cuaderno-docente-copia-${new Date().toISOString().slice(0,10)}.json"`);
  res.json({ formato: 'cuaderno-docente-backup', version: 1, exportado: new Date().toISOString(), por: req.user.username,
    nota: 'Las contraseñas están cifradas (bcrypt) para que los usuarios puedan volver a entrar tras restaurar.',
    users, cuadernos, temporalizaciones });
});

// modo: 'anadir' (conserva lo actual, salta usuarios/temporalizaciones que ya existan) | 'reemplazar' (borra todo salvo el usuario actual)
app.post('/api/admin/import', auth, adminOnly, (req, res) => {
  const { data, modo } = req.body || {};
  if (!data || data.formato !== 'cuaderno-docente-backup') return res.status(400).json({ error: 'El fichero no es una copia de Cuaderno Docente' });
  if (modo === 'reemplazar' && req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede reemplazar todo' });
  const users = Array.isArray(data.users) ? data.users : [], cuads = Array.isArray(data.cuadernos) ? data.cuadernos : [], temps = Array.isArray(data.temporalizaciones) ? data.temporalizaciones : [];
  const r = { usuarios: 0, usuariosOmitidos: 0, cuadernos: 0, cuadernosOmitidos: 0, cuadernosSinDocente: 0, temporalizaciones: 0, temporalizacionesOmitidas: 0 };
  db.transaction(() => {
    if (modo === 'reemplazar') {
      db.prepare("DELETE FROM cuadernos").run(); db.prepare("DELETE FROM temporalizaciones").run();
      db.prepare("DELETE FROM users WHERE id != ?").run(req.user.id);
    }
    const insU = db.prepare("INSERT INTO users (username, password, role, display_name, created_at) VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))");
    for (const u of users) {
      const uname = String(u.username || '').trim(); if (!uname) continue;
      if (db.prepare("SELECT id FROM users WHERE username = ?").get(uname)) { r.usuariosOmitidos++; continue; }
      const role = ['docente', 'jefatura', 'admin'].includes(u.role) ? u.role : 'docente';
      const pass = /^\$2[aby]\$/.test(String(u.password || '')) ? u.password : bcrypt.hashSync(String(u.password || 'cambiar123'), 10);
      insU.run(uname, pass, role, String(u.display_name || uname), u.created_at || null); r.usuarios++;
    }
    const insC = db.prepare("INSERT INTO cuadernos (user_id, title, ciclo, state_json, calendar_json, plan_json, seguimiento_json, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))");
    for (const c of cuads) {
      const u = db.prepare("SELECT id FROM users WHERE username = ?").get(String(c.username || ''));
      if (!u) { r.cuadernosSinDocente++; continue; }
      if (c.created_at && db.prepare("SELECT id FROM cuadernos WHERE user_id = ? AND title = ? AND ciclo = ? AND created_at = ?").get(u.id, String(c.title || 'Mi Cuaderno'), String(c.ciclo || ''), c.created_at)) { r.cuadernosOmitidos++; continue; }
      const js = v => typeof v === 'string' ? v : JSON.stringify(v ?? {});
      insC.run(u.id, String(c.title || 'Mi Cuaderno'), String(c.ciclo || ''), js(c.state_json), typeof c.calendar_json === 'string' ? c.calendar_json : JSON.stringify(c.calendar_json ?? []),
        js(c.plan_json), js(c.seguimiento_json), c.updated_at || null, c.created_at || null); r.cuadernos++;
    }
    const insT = db.prepare("INSERT INTO temporalizaciones (nombre, curso, nivel, data_json, updated_by, updated_at, created_at) VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))");
    for (const t of temps) {
      const norm = normalizarTemporalizacion(t.data_json); if (!norm || !t.nombre) continue;
      const niv = normalizarNivel(t.nivel) ?? '';
      if (db.prepare("SELECT id FROM temporalizaciones WHERE nombre = ? AND curso = ? AND nivel = ?").get(t.nombre, String(t.curso || ''), niv)) { r.temporalizacionesOmitidas++; continue; }
      insT.run(String(t.nombre), String(t.curso || ''), niv, JSON.stringify(norm), String(t.updated_by || req.user.username), t.updated_at || null, t.created_at || null); r.temporalizaciones++;
    }
  })();
  res.json({ ok: true, ...r });
});

// === RESTABLECER APLICACIÓN (solo admin): borra cuadernos, temporalizaciones, caché y usuarios excepto el admin actual ===
app.post('/api/admin/reset', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador' });
  if (String((req.body || {}).confirm || '') !== 'BORRAR TODO') return res.status(400).json({ error: 'Confirmación incorrecta' });
  const r = db.transaction(() => ({
    cuadernos: db.prepare("DELETE FROM cuadernos").run().changes,
    temporalizaciones: db.prepare("DELETE FROM temporalizaciones").run().changes,
    catedu: db.prepare("DELETE FROM catedu_cache").run().changes,
    usuarios: db.prepare("DELETE FROM users WHERE id != ?").run(req.user.id).changes
  }))();
  try { db.exec("VACUUM"); } catch {}
  res.json({ ok: true, ...r });
});

// === PROXY + CACHÉ DE CATEDU (RAs/CEs) ===
// El navegador no puede leer centrosdocentes.catedu.es por CORS; el servidor sí. Se cachea en SQLite para todo el centro.
const CATEDU_HOST = 'centrosdocentes.catedu.es';
const CATEDU_TTL_MS = Number(process.env.CATEDU_TTL_DAYS || 30) * 86400000;

async function fetchCatedu(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'CuadernoDocente/1.0 (+proxy de centro)' } });
    if (!r.ok) throw new Error('CATEDU respondió ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || '';
    const m = ct.match(/charset=([\w-]+)/i);
    let charset = (m ? m[1] : '').toLowerCase();
    if (!charset) { const mm = buf.slice(0, 4096).toString('latin1').match(/charset=["']?([\w-]+)/i); charset = mm ? mm[1].toLowerCase() : ''; }
    let html;
    if (charset && charset !== 'utf-8' && charset !== 'utf8') {
      try { html = new TextDecoder(charset).decode(buf); } catch { html = buf.toString('latin1'); }
    } else {
      html = buf.toString('utf8');
      if (html.includes('\uFFFD')) html = buf.toString('latin1'); // no era UTF-8 pese a la cabecera
    }
    return html;
  } finally { clearTimeout(tid); }
}

app.get('/api/catedu', auth, async (req, res) => {
  const url = String(req.query.url || '');
  let u;
  try { u = new URL(url); } catch { return res.status(400).json({ error: 'URL no válida' }); }
  if (u.protocol !== 'https:' || u.hostname !== CATEDU_HOST) return res.status(400).json({ error: 'Solo se permite ' + CATEDU_HOST });
  const refresh = req.query.refresh === '1' && isPrivileged(req.user);
  const row = db.prepare("SELECT html, fetched_at FROM catedu_cache WHERE url = ?").get(url);
  if (row && !refresh && Date.now() - row.fetched_at < CATEDU_TTL_MS)
    return res.json({ html: row.html, cached: true, fetched_at: row.fetched_at });
  try {
    const html = await fetchCatedu(url);
    if (!html || html.trim().length < 200) throw new Error('Respuesta vacía');
    db.prepare("INSERT INTO catedu_cache (url, html, fetched_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET html = excluded.html, fetched_at = excluded.fetched_at")
      .run(url, html, Date.now());
    res.json({ html, cached: false, fetched_at: Date.now() });
  } catch (e) {
    // Si CATEDU no responde pero hay copia antigua, mejor eso que nada
    if (row) return res.json({ html: row.html, cached: true, stale: true, fetched_at: row.fetched_at });
    res.status(502).json({ error: 'No se pudo consultar CATEDU: ' + (e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message) });
  }
});

app.delete('/api/catedu/cache', auth, adminOnly, (req, res) => {
  const r = db.prepare("DELETE FROM catedu_cache").run();
  res.json({ ok: true, borradas: r.changes });
});

// Lista de ciclos distintos (admin/jefatura)
app.get('/api/ciclos', auth, adminOnly, (req, res) => {
  const rows = db.prepare("SELECT DISTINCT ciclo FROM cuadernos WHERE ciclo != '' ORDER BY ciclo").all();
  res.json(rows.map(r => r.ciclo));
});

// Cuadernos con seguimiento de un ciclo (admin/jefatura)
app.get('/api/seguimientos', auth, adminOnly, (req, res) => {
  const ciclo = String(req.query.ciclo || '');
  const list = db.prepare(`
    SELECT c.id, c.title, c.ciclo, c.seguimiento_json, c.state_json,
           u.display_name, u.username
    FROM cuadernos c JOIN users u ON c.user_id = u.id
    WHERE c.ciclo = ?
    ORDER BY u.display_name, c.title
  `).all(ciclo);
  res.json(list.map(c => {
    let seg = {}, st = {};
    try { seg = JSON.parse(c.seguimiento_json || '{}'); } catch {}
    try { st  = JSON.parse(c.state_json       || '{}'); } catch {}
    return { ...c, seguimiento_json: seg, state_json: st };
  }));
});

// === ADMIN/JEFATURA: all cuadernos ===
app.get('/api/cuadernos', auth, adminOnly, (req, res) => {
  res.json(db.prepare(`
    SELECT c.id, c.title, c.ciclo, c.updated_at, c.created_at,
           u.id as user_id, u.username, u.display_name,
           CASE WHEN c.state_json != '{}' AND c.state_json != '' THEN 1 ELSE 0 END as has_state,
           CASE WHEN c.calendar_json != '[]' AND c.calendar_json != '' THEN 1 ELSE 0 END as has_calendar
    FROM cuadernos c JOIN users u ON c.user_id = u.id
    ORDER BY c.ciclo, u.display_name, c.updated_at DESC
  `).all());
});

app.get('/api/cuadernos/:id', auth, adminOnly, (req, res) => {
  const c = db.prepare("SELECT c.*, u.username, u.display_name FROM cuadernos c JOIN users u ON c.user_id = u.id WHERE c.id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  res.json(parseCuaderno(c));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Cuaderno Docente en puerto ${PORT}`));
