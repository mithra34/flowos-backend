const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

// ─── Validation rules ─────────────────────────────────────────────────────────
const clientValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('company').trim().notEmpty().withMessage('Company is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').optional().trim(),
  body('industry').optional().trim(),
  body('website').optional().trim(),
  body('notes').optional().trim(),
];

// ─── GET /api/clients — list all clients ─────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM clients ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /clients error:', err);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// ─── GET /api/clients/:id — single client ────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM clients WHERE id = ?', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

// ─── POST /api/clients — create client ───────────────────────────────────────
router.post('/', clientValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, company, email, phone, industry, website, notes } = req.body;
  try {
    const [result] = await db.query(
      `INSERT INTO clients (name, company, email, phone, industry, website, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, company, email, phone || null, industry || null, website || null, notes || null]
    );
    const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A client with this email already exists' });
    }
    console.error('POST /clients error:', err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// ─── PUT /api/clients/:id — update client ────────────────────────────────────
router.put('/:id', clientValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, company, email, phone, industry, website, notes } = req.body;
  try {
    const [result] = await db.query(
      `UPDATE clients SET name=?, company=?, email=?, phone=?, industry=?, website=?, notes=?
       WHERE id = ?`,
      [name, company, email, phone || null, industry || null, website || null, notes || null, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Client not found' });
    const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// ─── DELETE /api/clients/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

module.exports = router;
