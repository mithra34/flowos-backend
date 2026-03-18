require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_NAME:', process.env.DB_NAME);

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','PATCH'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = mysql.createPool({
  host:     process.env.DB_HOST || 'mysql.railway.internal',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'VsUxWidVQlQGZFPLTfOERbnjcQzZOpoa',
  database: process.env.DB_NAME || 'railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

pool.getConnection()
  .then(c => { console.log('✅ MySQL connected'); c.release(); })
  .catch(err => { console.error('❌ DB failed:', err.message); });

// ─── EMAIL (Resend) ───────────────────────────────────────────────────────────
const RESEND_KEY = process.env.RESEND_API_KEY || 're_Di9qDLqZ_EMeLs5f3SQmgo8TFaQMhZtU7';
const FROM_EMAIL = process.env.FROM_EMAIL || 'FlowOS <onboarding@resend.dev>';

async function sendEmail(to, subject, html) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
    });
    const data = await res.json();
    if (data.id) console.log('✅ Email sent to', to);
    else console.error('❌ Email failed:', JSON.stringify(data));
  } catch (e) { console.error('❌ Email error:', e.message); }
}

async function notifyMember(memberId, subject, html) {
  if (!memberId) return;
  try {
    const [rows] = await pool.query('SELECT * FROM team_members WHERE id=?', [memberId]);
    if (!rows.length) return;
    const member = rows[0];
    if (member.email) await sendEmail(member.email, subject, html);
    else console.log('⚠ No email for member:', member.name);
  } catch (e) { console.error('❌ notifyMember error:', e.message); }
}

function emailTemplate(heading, memberName, rows, note) {
  const rowsHtml = rows.map((([k,v],i) => `<tr style="background:${i%2?'#fff':'#f5f7ff'}"><td style="padding:10px 14px;border:1px solid #e0e0e0;font-weight:bold;width:130px">${k}</td><td style="padding:10px 14px;border:1px solid #e0e0e0">${v||'—'}</td></tr>`)).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:20px">
    <div style="background:#4A7CFF;padding:20px;border-radius:8px 8px 0 0"><h1 style="color:#fff;margin:0;font-size:20px">VICORPORATE</h1></div>
    <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0">
      <h2 style="color:#1a1a2e;margin-top:0">${heading}</h2>
      <p style="color:#555">Hi <strong>${memberName}</strong>,</p>
      <p style="color:#555">${note}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">${rowsHtml}</table>
      <p style="color:#888;font-size:13px;margin-top:24px;border-top:1px solid #eee;padding-top:16px">— VICORPORATE Project Management</p>
    </div>
  </div>`;
}

// ─── DEADLINE CHECKER (every hour) ───────────────────────────────────────────
async function checkDeadlines() {
  try {
    const [tasks] = await pool.query(`
      SELECT t.*, tm.name AS member_name, tm.email, p.name AS project_name
      FROM tasks t
      LEFT JOIN team_members tm ON t.assigned_to = tm.id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.status != 'completed'
        AND t.due_date IS NOT NULL
        AND t.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        AND t.assigned_to IS NOT NULL
    `);
    for (const task of tasks) {
      if (!task.email) continue;
      const html = emailTemplate('⏰ Task Due Tomorrow', task.member_name,
        [['Task', task.title], ['Project', task.project_name], ['Priority', task.priority], ['Due Date', task.due_date]],
        'This is a reminder that the following task is due <strong>tomorrow</strong>. Please complete it on time.'
      );
      await sendEmail(task.email, `⏰ Reminder: "${task.title}" is due tomorrow`, html);
      console.log('📅 Deadline reminder sent for:', task.title);
    }
  } catch (e) { console.error('❌ Deadline check error:', e.message); }
}
setInterval(checkDeadlines, 60 * 60 * 1000);
setTimeout(checkDeadlines, 5000);

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

// ─── PROJECTS ────────────────────────────────────────────────────────────────
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
      `INSERT INTO tasks (title,project_id,department,priority,assigned_to,due_date,description,status) VALUES (?,?,?,?,?,?,?,'pending')`,
      [title, project_id, department||'Website', priority||'medium', assigned_to||null, due_date||null, description||null]
    );
    const [rows] = await pool.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini,
             p.name AS project_name
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to=tm.id
      LEFT JOIN projects p ON t.project_id=p.id WHERE t.id=?`, [r.insertId]);
    const task = rows[0];

    // ── Email: task assigned ──────────────────────────────────────────────────
    if (assigned_to && task.assignee_name) {
      const html = emailTemplate('📋 New Task Assigned', task.assignee_name,
        [['Task', title], ['Project', task.project_name], ['Priority', priority||'medium'], ['Department', department||'Website'], ['Due Date', due_date||null]],
        'You have been assigned a new task in FlowOS. Please review the details below and get started.'
      );
      await notifyMember(assigned_to, `📋 New Task: ${title}`, html);
    }
    res.status(201).json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/tasks/:id', async (req, res) => {
  const { title, project_id, department, priority, assigned_to, due_date, description, status } = req.body;
  if (!title || !project_id) return res.status(422).json({ error: 'title and project_id are required' });
  try {
    const [prev] = await pool.query('SELECT * FROM tasks WHERE id=?', [req.params.id]);
    const [r] = await pool.query(
      'UPDATE tasks SET title=?,project_id=?,department=?,priority=?,assigned_to=?,due_date=?,description=?,status=? WHERE id=?',
      [title, project_id, department||'Website', priority||'medium', assigned_to||null, due_date||null, description||null, status||'pending', req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini,
             p.name AS project_name
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to=tm.id
      LEFT JOIN projects p ON t.project_id=p.id WHERE t.id=?`, [req.params.id]);
    const task = rows[0];

    // ── Email: reassigned to new member ──────────────────────────────────────
    if (assigned_to && prev[0] && prev[0].assigned_to != assigned_to) {
      const html = emailTemplate('📋 Task Assigned to You', task.assignee_name,
        [['Task', title], ['Project', task.project_name], ['Priority', priority||'medium'], ['Department', department||'Website']],
        'A task has been assigned to you in FlowOS.'
      );
      await notifyMember(assigned_to, `📋 Task Assigned: ${title}`, html);
    }
    res.json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/tasks/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['pending','in_progress','blocked','completed'].includes(status))
    return res.status(422).json({ error: 'Invalid status' });
  try {
    const [prev] = await pool.query(`
      SELECT t.*, tm.name AS assignee_name, p.name AS project_name
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to=tm.id
      LEFT JOIN projects p ON t.project_id=p.id WHERE t.id=?`, [req.params.id]);
    const [r] = await pool.query('UPDATE tasks SET status=? WHERE id=?', [status, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Not found' });

    // ── Email: status changed ─────────────────────────────────────────────────
    if (prev[0] && prev[0].assigned_to) {
      const task = prev[0];
      const label = {pending:'Pending',in_progress:'In Progress',blocked:'Blocked',completed:'Completed'}[status]||status;
      const html = emailTemplate('🔄 Task Status Updated', task.assignee_name,
        [['Task', task.title], ['Project', task.project_name], ['New Status', label]],
        'The status of your task has been updated in FlowOS.'
      );
      await notifyMember(task.assigned_to, `🔄 Status Update: ${task.title}`, html);
    }
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
             tm.department AS assignee_dept, tm.initials AS assignee_ini,
             p.name AS project_name
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to=tm.id
      LEFT JOIN projects p ON t.project_id=p.id WHERE t.id=?`, [req.params.id]);
    const task = rows[0];

    // ── Email: assigned via assign button ─────────────────────────────────────
    if (assigned_to && task.assignee_name) {
      const html = emailTemplate('📋 Task Assigned to You', task.assignee_name,
        [['Task', task.title], ['Project', task.project_name], ['Priority', task.priority], ['Department', task.department]],
        'You have been assigned a task in FlowOS. Log in to view the details.'
      );
      await notifyMember(assigned_to, `📋 Task Assigned: ${task.title}`, html);
    }
    res.json(task);
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

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

app.listen(PORT, () => console.log(`🚀 FlowOS API running on port ${PORT}`));
