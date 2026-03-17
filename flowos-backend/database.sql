CREATE DATABASE IF NOT EXISTS flowos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE flowos;

CREATE TABLE IF NOT EXISTS clients (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  company     VARCHAR(120) NOT NULL,
  email       VARCHAR(180) NOT NULL UNIQUE,
  phone       VARCHAR(30),
  industry    VARCHAR(100),
  website     VARCHAR(255),
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  client_id   INT NOT NULL,
  priority    ENUM('high','medium','low') NOT NULL DEFAULT 'medium',
  status      ENUM('active','completed','on_hold','cancelled') NOT NULL DEFAULT 'active',
  deadline    DATE,
  description TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_members (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  role        VARCHAR(100) NOT NULL,
  department  ENUM('Website','SEO','Content') NOT NULL,
  email       VARCHAR(180) UNIQUE,
  initials    VARCHAR(3),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  project_id  INT NOT NULL,
  department  ENUM('Website','SEO','Content') NOT NULL,
  priority    ENUM('high','medium','low') NOT NULL DEFAULT 'medium',
  status      ENUM('pending','in_progress','blocked','completed') NOT NULL DEFAULT 'pending',
  assigned_to INT,
  due_date    DATE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id)  REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL
);

INSERT INTO team_members (name, role, department, email, initials) VALUES
  ('Alex Chen',    'UI/UX Designer',      'Website', 'alex@team.co',   'AC'),
  ('Sam Rivera',   'Frontend Developer',  'Website', 'sam@team.co',    'SR'),
  ('Jordan Kim',   'SEO Specialist',      'SEO',     'jordan@team.co', 'JK'),
  ('Taylor Wong',  'Analytics Expert',    'SEO',     'taylor@team.co', 'TW'),
  ('Morgan Davis', 'Senior Copywriter',   'Content', 'morgan@team.co', 'MD'),
  ('Casey Park',   'Content Strategist',  'Content', 'casey@team.co',  'CP');
