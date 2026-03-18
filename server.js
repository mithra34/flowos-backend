require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','PATCH'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── DB Pool ─────────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
pool.getConnection()
  .then(c => { console.log('✅ MySQL connected'); c.release(); })
  .catch(err => { console.error('❌ DB failed:', err.message); });
```

Commit the change.

---

**Fix 3 — Set hardcoded variables in Railway**

Click **flowos-backend** → **Variables** tab → delete all existing DB variables → add each one manually with the **real values** you copied from MySQL service:
```
DB_HOST     = monorail.proxy.rlwy.net   ← real value from MySQL
DB_PORT     = 12345                      ← real port from MySQL  
DB_USER     = root                       ← real user
DB_PASSWORD = xxxxxxxx                   ← real password
DB_NAME     = railway
PORT        = 3000
ALLOWED_ORIGIN = *

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── CLIENTS ─────────────────────────────────────────────────────────────────
app.get('/api/clients', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clients WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients', async (req, res) => {
  const { name, company, email, phone, industry, website, notes } = req.body;
  if (!name || !company || !email) return res.status(422).json({ error: 'name, company and email are required' });
  try {
    const [r] = await pool.query(
      'INSERT INTO clients (name,company,email,phone,industry,website,notes) VALUES (?,?,?,?,?,?,?)',
      [name, company, email, phone||null, industry||null, website||null, notes||null]
    );
    const [rows] = await pool.query('SELECT * FROM clients WHERE id=?', [r.insertId]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  const { name, company, email, phone, industry, website, notes } = req.body;
  if (!name || !company || !email) return res.status(422).json({ error: 'name, company and email are required' });
  try {
    const [r] = await pool.query(
      'UPDATE clients SET name=?,company=?,email=?,phone=?,industry=?,website=?,notes=? WHERE id=?',
      [name, company, email, phone||null, industry||null, website||null, notes||null, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query('SELECT * FROM clients WHERE id=?', [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM clients WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PROJECTS ─────────────────────────────────────────────────────────────────
app.get('/api/projects', async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, c.name AS client_name, c.company AS client_company,
             COUNT(t.id) AS total_tasks,
             SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed_tasks
      FROM projects p
      LEFT JOIN clients c ON p.client_id=c.id
      LEFT JOIN tasks t ON t.project_id=p.id
      GROUP BY p.id ORDER BY p.created_at DESC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/projects/:id', async (req, res) => {
  try {
    const [projects] = await pool.query(`
      SELECT p.*, c.name AS client_name, c.company AS client_company, c.email AS client_email
      FROM projects p LEFT JOIN clients c ON p.client_id=c.id WHERE p.id=?`, [req.params.id]);
    if (!projects.length) return res.status(404).json({ error: 'Not found' });
    const [tasks] = await pool.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to=tm.id
      WHERE t.project_id=? ORDER BY t.created_at ASC`, [req.params.id]);
    res.json({ ...projects[0], tasks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects', async (req, res) => {
  const { name, client_id, priority, deadline, description } = req.body;
  if (!name || !client_id) return res.status(422).json({ error: 'name and client_id are required' });
  try {
    const [r] = await pool.query(
      `INSERT INTO projects (name,client_id,priority,deadline,description,status) VALUES (?,?,?,?,?,'active')`,
      [name, client_id, priority||'medium', deadline||null, description||null]
    );
    const [rows] = await pool.query(`
      SELECT p.*, c.name AS client_name, c.company AS client_company
      FROM projects p LEFT JOIN clients c ON p.client_id=c.id WHERE p.id=?`, [r.insertId]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:id', async (req, res) => {
  const { name, client_id, priority, deadline, description, status } = req.body;
  if (!name || !client_id) return res.status(422).json({ error: 'name and client_id are required' });
  try {
    const [r] = await pool.query(
      'UPDATE projects SET name=?,client_id=?,priority=?,deadline=?,description=?,status=? WHERE id=?',
      [name, client_id, priority||'medium', deadline||null, description||null, status||'active', req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query(`
      SELECT p.*, c.name AS client_name, c.company AS client_company
      FROM projects p LEFT JOIN clients c ON p.client_id=c.id WHERE p.id=?`, [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE project_id=?', [req.params.id]);
    const [r] = await pool.query('DELETE FROM projects WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── TASKS ────────────────────────────────────────────────────────────────────
app.get('/api/tasks', async (req, res) => {
  try {
    let q = `SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini,
             p.name AS project_name, c.company AS client_company
      FROM tasks t
      LEFT JOIN team_members tm ON t.assigned_to=tm.id
      LEFT JOIN projects p ON t.project_id=p.id
      LEFT JOIN clients c ON p.client_id=c.id WHERE 1=1`;
    const params = [];
    if (req.query.project_id) { q += ' AND t.project_id=?'; params.push(req.query.project_id); }
    if (req.query.status)     { q += ' AND t.status=?';     params.push(req.query.status); }
    if (req.query.department) { q += ' AND t.department=?'; params.push(req.query.department); }
    if (req.query.assigned_to){ q += ' AND t.assigned_to=?';params.push(req.query.assigned_to); }
    q += ' ORDER BY t.created_at DESC';
    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tasks/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini, p.name AS project_name
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to=tm.id
      LEFT JOIN projects p ON t.project_id=p.id WHERE t.id=?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks', async (req, res) => {
  const { title, project_id, department, priority, assigned_to, due_date, description } = req.body;
  if (!title || !project_id) return res.status(422).json({ error: 'title and project_id are required' });
  try {
    const [r] = await pool.query(
      `INSERT INTO tasks (title,project_id,department,priority,assigned_to,due_date,description,status)
       VALUES (?,?,?,?,?,?,?,'pending')`,
      [title, project_id, department||'Website', priority||'medium', assigned_to||null, due_date||null, description||null]
    );
    const [rows] = await pool.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to=tm.id WHERE t.id=?`, [r.insertId]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/tasks/:id', async (req, res) => {
  const { title, project_id, department, priority, assigned_to, due_date, description, status } = req.body;
  if (!title || !project_id) return res.status(422).json({ error: 'title and project_id are required' });
  try {
    const [r] = await pool.query(
      'UPDATE tasks SET title=?,project_id=?,department=?,priority=?,assigned_to=?,due_date=?,description=?,status=? WHERE id=?',
      [title, project_id, department||'Website', priority||'medium', assigned_to||null, due_date||null, description||null, status||'pending', req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to=tm.id WHERE t.id=?`, [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/tasks/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['pending','in_progress','blocked','completed'].includes(status))
    return res.status(422).json({ error: 'Invalid status' });
  try {
    const [r] = await pool.query('UPDATE tasks SET status=? WHERE id=?', [status, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    res.json({ id: req.params.id, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/tasks/:id/assign', async (req, res) => {
  const { assigned_to } = req.body;
  try {
    const [r] = await pool.query('UPDATE tasks SET assigned_to=? WHERE id=?', [assigned_to||null, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to=tm.id WHERE t.id=?`, [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM tasks WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── TEAM ─────────────────────────────────────────────────────────────────────
app.get('/api/team', async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT tm.*, COUNT(CASE WHEN t.status!='completed' THEN 1 END) AS active_tasks,
             COUNT(t.id) AS total_tasks
      FROM team_members tm LEFT JOIN tasks t ON t.assigned_to=tm.id
      GROUP BY tm.id ORDER BY tm.name ASC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/team/:id', async (req, res) => {
  try {
    const [members] = await pool.query('SELECT * FROM team_members WHERE id=?', [req.params.id]);
    if (!members.length) return res.status(404).json({ error: 'Not found' });
    const [tasks] = await pool.query(`
      SELECT t.*, p.name AS project_name FROM tasks t
      LEFT JOIN projects p ON t.project_id=p.id
      WHERE t.assigned_to=? ORDER BY t.due_date ASC`, [req.params.id]);
    res.json({ ...members[0], tasks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/team', async (req, res) => {
  const { name, role, department, email } = req.body;
  if (!name || !role || !department) return res.status(422).json({ error: 'name, role and department are required' });
  const initials = name.trim().split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);
  try {
    const [r] = await pool.query(
      'INSERT INTO team_members (name,role,department,email,initials) VALUES (?,?,?,?,?)',
      [name, role, department, email||null, initials]
    );
    const [rows] = await pool.query('SELECT * FROM team_members WHERE id=?', [r.insertId]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/team/:id', async (req, res) => {
  const { name, role, department, email } = req.body;
  if (!name || !role || !department) return res.status(422).json({ error: 'name, role and department are required' });
  const initials = name.trim().split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);
  try {
    const [r] = await pool.query(
      'UPDATE team_members SET name=?,role=?,department=?,email=?,initials=? WHERE id=?',
      [name, role, department, email||null, initials, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query('SELECT * FROM team_members WHERE id=?', [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/team/:id', async (req, res) => {
  try {
    await pool.query('UPDATE tasks SET assigned_to=NULL WHERE assigned_to=?', [req.params.id]);
    const [r] = await pool.query('DELETE FROM team_members WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

app.listen(PORT, () => console.log(`🚀 FlowOS API running on port ${PORT}`));
