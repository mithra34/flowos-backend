const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

const taskValidation = [
  body('title').trim().notEmpty().withMessage('Task title is required'),
  body('project_id').isInt().withMessage('Valid project ID is required'),
  body('department').isIn(['Website', 'SEO', 'Content']).withMessage('Department must be Website, SEO, or Content'),
  body('priority').isIn(['high', 'medium', 'low']).withMessage('Priority must be high, medium, or low'),
  body('assigned_to').optional({ nullable: true }).isInt(),
  body('due_date').optional({ nullable: true }).isDate(),
  body('description').optional().trim(),
];

// ─── GET /api/tasks — all tasks (with assignee + project info) ───────────────
router.get('/', async (req, res) => {
  try {
    let query = `
      SELECT t.*, 
             tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini,
             p.name AS project_name, c.company AS client_company
      FROM tasks t
      LEFT JOIN team_members tm ON t.assigned_to = tm.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (req.query.project_id) {
      query += ' AND t.project_id = ?';
      params.push(req.query.project_id);
    }
    if (req.query.status) {
      query += ' AND t.status = ?';
      params.push(req.query.status);
    }
    if (req.query.department) {
      query += ' AND t.department = ?';
      params.push(req.query.department);
    }
    if (req.query.assigned_to) {
      query += ' AND t.assigned_to = ?';
      params.push(req.query.assigned_to);
    }

    query += ' ORDER BY t.created_at DESC';

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /tasks error:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// ─── GET /api/tasks/:id — single task ────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT t.*,
             tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini,
             p.name AS project_name, c.company AS client_company
      FROM tasks t
      LEFT JOIN team_members tm ON t.assigned_to = tm.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE t.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// ─── POST /api/tasks — create task ───────────────────────────────────────────
router.post('/', taskValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { title, project_id, department, priority, assigned_to, due_date, description } = req.body;
  try {
    const [result] = await db.query(
      `INSERT INTO tasks (title, project_id, department, priority, assigned_to, due_date, description, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [title, project_id, department, priority, assigned_to || null, due_date || null, description || null]
    );
    const [rows] = await db.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini
      FROM tasks t
      LEFT JOIN team_members tm ON t.assigned_to = tm.id
      WHERE t.id = ?
    `, [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /tasks error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// ─── PUT /api/tasks/:id — full update ────────────────────────────────────────
router.put('/:id', taskValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { title, project_id, department, priority, assigned_to, due_date, description, status } = req.body;
  try {
    const [result] = await db.query(
      `UPDATE tasks 
       SET title=?, project_id=?, department=?, priority=?, assigned_to=?, due_date=?, description=?, status=?
       WHERE id = ?`,
      [title, project_id, department, priority, assigned_to || null, due_date || null, description || null,
       status || 'pending', req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Task not found' });
    const [rows] = await db.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to = tm.id
      WHERE t.id = ?
    `, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// ─── PATCH /api/tasks/:id/status — update status only ───────────────────────
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'in_progress', 'blocked', 'completed'];
  if (!validStatuses.includes(status)) {
    return res.status(422).json({ error: 'Status must be pending, in_progress, blocked, or completed' });
  }
  try {
    const [result] = await db.query('UPDATE tasks SET status=? WHERE id=?', [status, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Task not found' });
    res.json({ id: req.params.id, status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task status' });
  }
});

// ─── PATCH /api/tasks/:id/assign — assign/unassign ───────────────────────────
router.patch('/:id/assign', async (req, res) => {
  const { assigned_to } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE tasks SET assigned_to=? WHERE id=?',
      [assigned_to || null, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Task not found' });
    const [rows] = await db.query(`
      SELECT t.*, tm.name AS assignee_name, tm.role AS assignee_role,
             tm.department AS assignee_dept, tm.initials AS assignee_ini
      FROM tasks t LEFT JOIN team_members tm ON t.assigned_to = tm.id
      WHERE t.id = ?
    `, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign task' });
  }
});

// ─── DELETE /api/tasks/:id ────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;
