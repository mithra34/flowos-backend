const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

const projectValidation = [
  body('name').trim().notEmpty().withMessage('Project name is required'),
  body('client_id').isInt().withMessage('Valid client ID is required'),
  body('priority').isIn(['high', 'medium', 'low']).withMessage('Priority must be high, medium, or low'),
  body('deadline').optional({ nullable: true }).isDate().withMessage('Deadline must be a valid date'),
  body('description').optional().trim(),
];

// ─── GET /api/projects — all projects (with client name) ─────────────────────
router.get('/', async (_req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*, c.name AS client_name, c.company AS client_company,
             COUNT(t.id) AS total_tasks,
             SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed_tasks
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN tasks t ON t.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /projects error:', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// ─── GET /api/projects/:id — single project with tasks ───────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [projects] = await db.query(`
      SELECT p.*, c.name AS client_name, c.company AS client_company, c.email AS client_email
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [req.params.id]);

    if (!projects.length) return res.status(404).json({ error: 'Project not found' });

    const [tasks] = await db.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini
      FROM tasks t
      LEFT JOIN team_members tm ON t.assigned_to = tm.id
      WHERE t.project_id = ?
      ORDER BY t.created_at ASC
    `, [req.params.id]);

    res.json({ ...projects[0], tasks });
  } catch (err) {
    console.error('GET /projects/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// ─── GET /api/projects/client/:clientId — projects by client ─────────────────
router.get('/client/:clientId', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, COUNT(t.id) AS total_tasks,
              SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed_tasks
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id
       WHERE p.client_id = ?
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch client projects' });
  }
});

// ─── POST /api/projects — create project ─────────────────────────────────────
router.post('/', projectValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, client_id, priority, deadline, description } = req.body;
  try {
    const [result] = await db.query(
      `INSERT INTO projects (name, client_id, priority, deadline, description, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [name, client_id, priority, deadline || null, description || null]
    );
    const [rows] = await db.query(`
      SELECT p.*, c.name AS client_name, c.company AS client_company
      FROM projects p LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /projects error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ─── PUT /api/projects/:id — update project ───────────────────────────────────
router.put('/:id', projectValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, client_id, priority, deadline, description, status } = req.body;
  try {
    const [result] = await db.query(
      `UPDATE projects SET name=?, client_id=?, priority=?, deadline=?, description=?, status=?
       WHERE id = ?`,
      [name, client_id, priority, deadline || null, description || null, status || 'active', req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Project not found' });
    const [rows] = await db.query(`
      SELECT p.*, c.name AS client_name, c.company AS client_company
      FROM projects p LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM tasks WHERE project_id = ?', [req.params.id]);
    const [result] = await db.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Project not found' });
    res.json({ message: 'Project and its tasks deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
