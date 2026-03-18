const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

const memberValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('role').trim().notEmpty().withMessage('Role is required'),
  body('department').isIn(['Website', 'SEO', 'Content']).withMessage('Department must be Website, SEO, or Content'),
  body('email').optional({ nullable: true }).isEmail(),
];

// ─── GET /api/team — all members with active task count ───────────────────────
router.get('/', async (_req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT tm.*,
             COUNT(CASE WHEN t.status != 'completed' THEN 1 END) AS active_tasks,
             COUNT(t.id) AS total_tasks
      FROM team_members tm
      LEFT JOIN tasks t ON t.assigned_to = tm.id
      GROUP BY tm.id
      ORDER BY tm.name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /team error:', err);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

// ─── GET /api/team/:id — single member with their tasks ──────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [members] = await db.query('SELECT * FROM team_members WHERE id = ?', [req.params.id]);
    if (!members.length) return res.status(404).json({ error: 'Team member not found' });

    const [tasks] = await db.query(`
      SELECT t.*, p.name AS project_name, c.company AS client_company
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE t.assigned_to = ?
      ORDER BY t.due_date ASC
    `, [req.params.id]);

    res.json({ ...members[0], tasks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch team member' });
  }
});

// ─── GET /api/team/department/:dept — members by department ──────────────────
router.get('/department/:dept', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT tm.*,
             COUNT(CASE WHEN t.status != 'completed' THEN 1 END) AS active_tasks
      FROM team_members tm
      LEFT JOIN tasks t ON t.assigned_to = tm.id
      WHERE tm.department = ?
      GROUP BY tm.id
      ORDER BY active_tasks ASC
    `, [req.params.dept]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch department members' });
  }
});

// ─── POST /api/team — add team member ────────────────────────────────────────
router.post('/', memberValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, role, department, email } = req.body;
  const initials = name.trim().split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  try {
    const [result] = await db.query(
      `INSERT INTO team_members (name, role, department, email, initials)
       VALUES (?, ?, ?, ?, ?)`,
      [name, role, department, email || null, initials]
    );
    const [rows] = await db.query('SELECT * FROM team_members WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A team member with this email already exists' });
    }
    console.error('POST /team error:', err);
    res.status(500).json({ error: 'Failed to add team member' });
  }
});

// ─── PUT /api/team/:id — update member ───────────────────────────────────────
router.put('/:id', memberValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, role, department, email } = req.body;
  const initials = name.trim().split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  try {
    const [result] = await db.query(
      `UPDATE team_members SET name=?, role=?, department=?, email=?, initials=? WHERE id=?`,
      [name, role, department, email || null, initials, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Team member not found' });
    const [rows] = await db.query('SELECT * FROM team_members WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

// ─── DELETE /api/team/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await db.query('UPDATE tasks SET assigned_to = NULL WHERE assigned_to = ?', [req.params.id]);
    const [result] = await db.query('DELETE FROM team_members WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Team member not found' });
    res.json({ message: 'Team member removed, tasks unassigned' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove team member' });
  }
});

module.exports = router;
