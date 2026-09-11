const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const totp = require('./totp');
const {
  getSmtpConfig,
  sendAdminNewRegistrationAlert,
  sendClientRegistrationReceived,
  sendClientAccountApproved,
  sendClientAccountDenied,
  sendTestEmail
} = require('./email');

// Multi-path .env loader and manual fallback parser
const searchedEnvPaths = [];

function loadEnvFromAllSources() {
  const possiblePaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'server', '.env'),
    path.join(process.cwd(), '..', '.env'),
    path.join(__dirname, 'env'),
    path.join(__dirname, '..', 'env'),
    path.join(process.cwd(), 'env'),
    path.join(__dirname, '.env.production'),
    path.join(process.cwd(), '.env.production')
  ];

  // Try standard dotenv
  try {
    const dotenv = require('dotenv');
    dotenv.config();
    possiblePaths.forEach(p => dotenv.config({ path: p }));
  } catch (e) { }

  // Manual fallback parser in case dotenv is missing or skipped
  searchedEnvPaths.length = 0;
  for (const envPath of possiblePaths) {
    const exists = fs.existsSync(envPath);
    searchedEnvPaths.push({ path: envPath, exists });
    if (exists) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1).trim();
            }
            if (!process.env[key] || process.env[key] === '') {
              process.env[key] = val;
            }
          }
        }
      } catch (e) { }
    }
  }
}

loadEnvFromAllSources();

const app = express();
app.use(cors());
app.use(express.json());

// Helper to strip quotes & trim env strings
function cleanEnv(val, fallback = '') {
  if (!val) return fallback;
  let str = String(val).trim();
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

// Admin Credentials & Authentication Secret
let ADMIN_USERNAME = cleanEnv(process.env.ADMIN_USER, 'admin');
let ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASS, 'admin123');
const AUTH_SECRET = cleanEnv(process.env.AUTH_SECRET, 'remoteg-unio-tech-it-auth-secret-key-2026');

// ----------------------------------------------------
// cPanel MySQL & Persistent Storage Setup
// ----------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ADMIN_CONFIG_FILE = path.join(DATA_DIR, 'admin-config.json');

let dbPool = null;
let isMysqlActive = false;

function getDbConfig() {
  loadEnvFromAllSources();
  ADMIN_USERNAME = cleanEnv(process.env.ADMIN_USER, ADMIN_USERNAME);
  ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASS, ADMIN_PASSWORD);
  let rawHost = cleanEnv(process.env.DB_HOST, '127.0.0.1');
  if (rawHost.toLowerCase() === 'localhost') {
    rawHost = '127.0.0.1';
  }
  return {
    host: rawHost,
    user: cleanEnv(process.env.DB_USER),
    pass: cleanEnv(process.env.DB_PASSWORD || process.env.DB_PASS),
    name: cleanEnv(process.env.DB_NAME),
    port: process.env.DB_PORT ? parseInt(cleanEnv(process.env.DB_PORT)) : 3306
  };
}

let dbStatusInfo = {
  isMysqlActive: false,
  dbName: '(Not configured in .env)',
  dbUser: '(Not configured in .env)',
  dbHost: '127.0.0.1',
  dbPort: 3306,
  error: null,
  mysql2Installed: false,
  lastChecked: new Date().toISOString()
};

async function syncLocalUsersToMysql() {
  if (!isMysqlActive || !dbPool) return 0;
  try {
    const localUsers = getRegisteredUsersLocal();
    let synced = 0;
    for (const u of localUsers) {
      if (!u.email) continue;
      const cleanEmail = String(u.email).trim().toLowerCase();
      const [rows] = await dbPool.query('SELECT id FROM registered_users WHERE LOWER(email) = ? LIMIT 1', [cleanEmail]);
      if (!rows || rows.length === 0) {
        await dbPool.query(
          'INSERT INTO registered_users (id, name, company_name, phone, email, desktop_count, password, role, status, mfa_enabled, mfa_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            u.id || ('usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
            u.name || 'User',
            u.companyName || '',
            u.phone || '',
            cleanEmail,
            u.desktopCount || '1-5 PCs',
            u.password || '',
            u.role || 'Client',
            u.status || 'approved',
            u.mfaEnabled ? 1 : 0,
            u.mfaSecret || null,
            u.registeredAt ? new Date(u.registeredAt) : new Date()
          ]
        );
        synced++;
      }
    }
    if (synced > 0) {
      console.log(`[cPanel MySQL Auto-Sync]: Successfully synced ${synced} user(s) from local storage to MySQL database.`);
    }
    return synced;
  } catch (err) {
    console.error('[cPanel MySQL Auto-Sync Error]:', err.message);
    return 0;
  }
}

async function initMysql() {
  const cfg = getDbConfig();
  dbStatusInfo.dbHost = cfg.host;
  dbStatusInfo.dbPort = cfg.port;
  dbStatusInfo.dbUser = cfg.user || '(Not configured in .env)';
  dbStatusInfo.dbName = cfg.name || '(Not configured in .env)';

  if (!cfg.user || !cfg.name) {
    dbStatusInfo.error = 'DB_USER or DB_NAME is missing in .env file.';
    return false;
  }

  try {
    const mysql = require('mysql2/promise');
    dbStatusInfo.mysql2Installed = true;

    if (!dbPool) {
      dbPool = mysql.createPool({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.pass,
        database: cfg.name,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
      });
    }

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS registered_users (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        company_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        desktop_count VARCHAR(50) DEFAULT '1-5 PCs',
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'Client',
        status VARCHAR(50) DEFAULT 'pending',
        mfa_enabled TINYINT(1) DEFAULT 0,
        mfa_secret VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Automatic column migrations for existing databases
    try { await dbPool.query("ALTER TABLE registered_users ADD COLUMN status VARCHAR(50) DEFAULT 'pending'"); } catch (e) { }
    try { await dbPool.query('ALTER TABLE registered_users ADD COLUMN mfa_enabled TINYINT(1) DEFAULT 0'); } catch (e) { }
    try { await dbPool.query('ALTER TABLE registered_users ADD COLUMN mfa_secret VARCHAR(100) DEFAULT NULL'); } catch (e) { }

    isMysqlActive = true;
    dbStatusInfo.isMysqlActive = true;
    dbStatusInfo.error = null;
    dbStatusInfo.lastChecked = new Date().toISOString();
    console.log(`[cPanel Database]: Connected to MySQL database "${cfg.name}" on ${cfg.host} successfully.`);

    // Auto-sync existing registered users into MySQL
    await syncLocalUsersToMysql();
    return true;
  } catch (err) {
    isMysqlActive = false;
    dbStatusInfo.isMysqlActive = false;
    dbStatusInfo.error = err.message;
    dbStatusInfo.lastChecked = new Date().toISOString();
    if (err.code === 'MODULE_NOT_FOUND') {
      dbStatusInfo.mysql2Installed = false;
      dbStatusInfo.error = 'mysql2 module not found in node_modules. Run npm install mysql2.';
    }
    console.error('[cPanel MySQL Error]:', err.message);
    return false;
  }
}

// Initial DB connect attempt
initMysql();

// Ensure Local Storage Folders
function ensureDataStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(ADMIN_CONFIG_FILE)) {
    fs.writeFileSync(ADMIN_CONFIG_FILE, JSON.stringify({ mfaEnabled: false, mfaSecret: null }, null, 2), 'utf8');
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  }
}

function getAdminConfig() {
  try {
    ensureDataStorage();
    const data = fs.readFileSync(ADMIN_CONFIG_FILE, 'utf8');
    return JSON.parse(data || '{}');
  } catch (e) {
    return { mfaEnabled: false, mfaSecret: null };
  }
}

function saveAdminConfig(cfg) {
  try {
    ensureDataStorage();
    fs.writeFileSync(ADMIN_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed saving admin config:', e);
    return false;
  }
}

function getRegisteredUsersLocal() {
  try {
    ensureDataStorage();
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    const users = JSON.parse(data || '[]');
    return users.map(u => ({
      ...u,
      status: u.status || 'approved'
    }));
  } catch (e) {
    return [];
  }
}

function saveRegisteredUserLocal(user) {
  try {
    ensureDataStorage();
    const users = getRegisteredUsersLocal();
    const idx = users.findIndex(u => u.id === user.id || (u.email && user.email && u.email.toLowerCase() === user.email.toLowerCase()));
    const sanitized = {
      ...user,
      status: user.status || 'pending'
    };
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...sanitized };
    } else {
      users.unshift(sanitized);
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed saving user to local storage:', e);
    return false;
  }
}

// Unified Async Database Operations (MySQL with Automatic Local Fallback)
async function getRegisteredUsersAsync() {
  if (isMysqlActive && dbPool) {
    try {
      const [rows] = await dbPool.query('SELECT id, name, company_name AS companyName, phone, email, desktop_count AS desktopCount, password, role, status, mfa_enabled AS mfaEnabled, mfa_secret AS mfaSecret, created_at AS createdAt FROM registered_users ORDER BY created_at DESC');
      return rows.map(r => ({
        ...r,
        status: r.status || 'approved'
      }));
    } catch (e) {
      console.error('MySQL query error, fallback to local:', e.message);
    }
  }
  return getRegisteredUsersLocal();
}

async function saveRegisteredUserAsync(user) {
  const userStatus = user.status || 'pending';
  if (isMysqlActive && dbPool) {
    try {
      await dbPool.query(
        'INSERT INTO registered_users (id, name, company_name, phone, email, desktop_count, password, role, status, mfa_enabled, mfa_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user.id, user.name, user.companyName, user.phone, user.email, user.desktopCount, user.password, user.role || 'Client', userStatus, user.mfaEnabled ? 1 : 0, user.mfaSecret || null]
      );
      saveRegisteredUserLocal({ ...user, status: userStatus });
      return true;
    } catch (e) {
      console.error('MySQL insert error, fallback to local:', e.message);
    }
  }
  return saveRegisteredUserLocal({ ...user, status: userStatus });
}

async function updateUserStatusAsync(emailOrId, newStatus) {
  const clean = String(emailOrId || '').trim().toLowerCase();
  const validStatus = ['approved', 'pending', 'denied'].includes(String(newStatus).toLowerCase())
    ? String(newStatus).toLowerCase()
    : 'approved';

  if (isMysqlActive && dbPool) {
    try {
      await dbPool.query(
        'UPDATE registered_users SET status = ? WHERE LOWER(email) = ? OR id = ?',
        [validStatus, clean, emailOrId]
      );
    } catch (e) {
      console.error('MySQL status update error:', e.message);
    }
  }

  const users = getRegisteredUsersLocal();
  const idx = users.findIndex(u => (u.email || '').toLowerCase() === clean || u.id === emailOrId);
  if (idx >= 0) {
    users[idx].status = validStatus;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    return users[idx];
  }
  return { id: emailOrId, status: validStatus };
}

async function deleteRegisteredUserAsync(emailOrId) {
  const clean = String(emailOrId || '').trim().toLowerCase();
  if (isMysqlActive && dbPool) {
    try {
      await dbPool.query(
        'DELETE FROM registered_users WHERE LOWER(email) = ? OR id = ?',
        [clean, emailOrId]
      );
    } catch (e) {
      console.error('MySQL delete user error:', e.message);
    }
  }

  const users = getRegisteredUsersLocal();
  const filtered = users.filter(u => (u.email || '').toLowerCase() !== clean && u.id !== emailOrId);
  fs.writeFileSync(USERS_FILE, JSON.stringify(filtered, null, 2), 'utf8');
  return true;
}

async function updateUserMfaAsync(emailOrId, { mfaEnabled, mfaSecret }) {
  const clean = String(emailOrId || '').trim().toLowerCase();
  if (isMysqlActive && dbPool) {
    try {
      await dbPool.query(
        'UPDATE registered_users SET mfa_enabled = ?, mfa_secret = ? WHERE LOWER(email) = ? OR id = ?',
        [mfaEnabled ? 1 : 0, mfaSecret || null, clean, emailOrId]
      );
    } catch (e) {
      console.error('MySQL MFA update error:', e.message);
    }
  }
  const users = getRegisteredUsersLocal();
  const idx = users.findIndex(u => (u.email || '').toLowerCase() === clean || u.id === emailOrId);
  if (idx >= 0) {
    users[idx].mfaEnabled = Boolean(mfaEnabled);
    users[idx].mfaSecret = mfaSecret || null;
    saveRegisteredUserLocal(users[idx]);
  }
  return true;
}

async function findUserByEmailAsync(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (isMysqlActive && dbPool) {
    try {
      const [rows] = await dbPool.query('SELECT id, name, company_name AS companyName, phone, email, desktop_count AS desktopCount, password, role, status, mfa_enabled AS mfaEnabled, mfa_secret AS mfaSecret, created_at AS createdAt FROM registered_users WHERE LOWER(email) = ? LIMIT 1', [clean]);
      if (rows && rows.length > 0) return { ...rows[0], status: rows[0].status || 'approved' };
    } catch (e) {
      console.error('MySQL lookup error:', e.message);
    }
  }
  const users = getRegisteredUsersLocal();
  const u = users.find(u => (u.email || '').toLowerCase() === clean);
  return u ? { ...u, status: u.status || 'approved' } : null;
}

async function findUserForLoginAsync(cleanUser, password) {
  if (isMysqlActive && dbPool) {
    try {
      const [rows] = await dbPool.query(
        'SELECT id, name, company_name AS companyName, phone, email, desktop_count AS desktopCount, password, role, status, mfa_enabled AS mfaEnabled, mfa_secret AS mfaSecret, created_at AS createdAt FROM registered_users WHERE (LOWER(email) = ? OR phone = ? OR LOWER(name) = ?) AND password = ? LIMIT 1',
        [cleanUser.toLowerCase(), cleanUser, cleanUser.toLowerCase(), password]
      );
      if (rows && rows.length > 0) return { ...rows[0], status: rows[0].status || 'approved' };
    } catch (e) {
      console.error('MySQL login query error:', e.message);
    }
  }
  const users = getRegisteredUsersLocal();
  const u = users.find(u =>
    ((u.email || '').toLowerCase() === cleanUser.toLowerCase() || u.phone === cleanUser || (u.name || '').toLowerCase() === cleanUser.toLowerCase()) &&
    u.password === password
  );
  return u ? { ...u, status: u.status || 'approved' } : null;
}

// Parse desktop limit number from string values (e.g. "1-5 PCs" -> 5, "5-10 PCs" -> 10, "10-25 PCs" -> 25, "50+ PCs" -> 100)
function parseDesktopLimit(desktopCount) {
  if (!desktopCount) return 5;
  if (typeof desktopCount === 'number') return Math.max(1, desktopCount);
  const str = String(desktopCount).trim();
  const rangeMatch = str.match(/(\d+)\s*(?:-|to)\s*(\d+)/i);
  if (rangeMatch) {
    return parseInt(rangeMatch[2], 10);
  }
  const plusMatch = str.match(/(\d+)\s*\+/);
  if (plusMatch) {
    return parseInt(plusMatch[1], 10) * 2;
  }
  const numMatch = str.match(/\d+/);
  if (numMatch) {
    return parseInt(numMatch[0], 10);
  }
  return 5;
}

// Find registered company account by company name / group code
async function findCompanyByNameOrGroupAsync(companyName) {
  const clean = String(companyName || '').trim().toUpperCase();
  if (!clean || clean === 'USPL' || clean === 'DEFAULT' || clean === 'ALL') return null;
  if (isMysqlActive && dbPool) {
    try {
      const [rows] = await dbPool.query(
        'SELECT id, name, company_name AS companyName, phone, email, desktop_count AS desktopCount, role, status FROM registered_users WHERE UPPER(company_name) = ? LIMIT 1',
        [clean]
      );
      if (rows && rows.length > 0) return { ...rows[0], status: rows[0].status || 'approved' };
    } catch (e) {
      console.error('MySQL company lookup error:', e.message);
    }
  }
  const users = getRegisteredUsersLocal();
  const u = users.find(u => (u.companyName || '').trim().toUpperCase() === clean);
  return u ? { ...u, status: u.status || 'approved' } : null;
}

// Get device count registered under a specific company group
function getCompanyDeviceStats(companyGroupName) {
  const cleanGroup = String(companyGroupName || '').trim().toUpperCase();
  if (!cleanGroup) return { currentCount: 0, roomIds: [] };

  const matchedRooms = [];
  for (const [roomId, room] of rooms.entries()) {
    const roomGroup = String(room.companyGroup || '').trim().toUpperCase();
    if (roomGroup === cleanGroup) {
      matchedRooms.push(roomId);
    }
  }
  return {
    currentCount: matchedRooms.length,
    roomIds: matchedRooms
  };
}

function generateAuthToken(user) {
  const isString = typeof user === 'string';
  const username = isString ? user : (user.email || user.username);
  const role = isString && user.toLowerCase() === ADMIN_USERNAME.toLowerCase() ? 'Administrator' : (!isString && user.role ? user.role : 'Client');

  const payload = {
    username,
    name: !isString && user.name ? user.name : (role === 'Administrator' ? 'System Administrator' : username),
    companyName: !isString && user.companyName ? user.companyName : 'USPL',
    phone: !isString && user.phone ? user.phone : '',
    email: !isString && user.email ? user.email : '',
    desktopCount: !isString && user.desktopCount ? user.desktopCount : '1-5 PCs',
    role,
    issuedAt: Date.now(),
    expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days session
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

// Temporary 5-Minute MFA Login Session Token
function generateMfaSessionToken(user) {
  const isString = typeof user === 'string';
  const username = isString ? user : (user.email || user.username);
  const role = isString && user.toLowerCase() === ADMIN_USERNAME.toLowerCase() ? 'Administrator' : (!isString && user.role ? user.role : 'Client');

  const payload = {
    isMfaPending: true,
    username,
    name: !isString && user.name ? user.name : (role === 'Administrator' ? 'System Administrator' : username),
    email: !isString && user.email ? user.email : (role === 'Administrator' ? 'admin@uniotechit.com' : username),
    role,
    expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes valid
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyMfaSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
  if (signature !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.isMfaPending) return null;
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
  if (signature !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.isMfaPending) return null; // MFA pending token is not a full session token
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ----------------------------------------------------
// Database Diagnostic & Health Check Endpoint
// ----------------------------------------------------
app.get('/api/debug/db-status', async (req, res) => {
  // Re-verify or try reconnecting if not active
  if (!isMysqlActive) {
    await initMysql();
  }

  const cfg = getDbConfig();
  let mysqlUserCount = 0;
  let mysqlError = dbStatusInfo.error;

  if (isMysqlActive && dbPool) {
    try {
      const [rows] = await dbPool.query('SELECT COUNT(*) AS cnt FROM registered_users');
      mysqlUserCount = rows[0]?.cnt || 0;
      // Also trigger auto-sync
      await syncLocalUsersToMysql();
    } catch (e) {
      mysqlError = e.message;
    }
  }

  const localUsers = getRegisteredUsersLocal();

  return res.json({
    status: isMysqlActive ? 'CONNECTED_TO_MYSQL' : 'USING_LOCAL_JSON_FALLBACK',
    isMysqlActive,
    config: {
      dbHost: cfg.host,
      dbPort: cfg.port,
      dbUser: cfg.user || '(Not configured)',
      dbName: cfg.name || '(Not configured)',
      hasPassword: Boolean(cfg.pass)
    },
    mysql2Installed: dbStatusInfo.mysql2Installed,
    foundEnvFiles: searchedEnvPaths.filter(x => x.exists).map(x => x.path),
    searchedEnvPaths: searchedEnvPaths.map(x => ({ path: x.path, exists: x.exists })),
    error: mysqlError,
    mysqlUserCount,
    localUserCount: localUsers.length,
    lastChecked: new Date().toISOString(),
    troubleshooting: !isMysqlActive ? [
      '1. cPanel me "MySQL Databases" me jayein aur check karein ki User Database se linked h ya nhi (Add User to Database with ALL PRIVILEGES).',
      '2. cPanel Node.js App me "Run NPM Install" click karein taaki mysql2 package install ho ske.',
      '3. .env file ko app ke root folder me check karein (DB_USER, DB_PASSWORD, DB_NAME sahi honi chahiye).',
      '4. cPanel me Node.js app ko "Restart" karein.'
    ] : [
      'MySQL is connected and active! Data is syncing automatically.'
    ]
  });
});

// Authentication REST Endpoints

// 1. User / Client Registration Endpoint
app.post('/api/auth/register', async (req, res) => {
  const { name, companyName, phone, email, desktopCount, password } = req.body || {};

  if (!name || !companyName || !phone || !email || !password) {
    return res.status(400).json({ error: 'All fields (Name, Company, Phone, Email, Password) are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPhone = String(phone).trim();
  const cleanName = String(name).trim();
  const cleanCompany = String(companyName).trim().toUpperCase();
  const cleanCount = String(desktopCount || '1-5 PCs').trim();

  const existing = await findUserByEmailAsync(cleanEmail);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists. Please login instead.' });
  }

  const newUser = {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    name: cleanName,
    companyName: cleanCompany,
    phone: cleanPhone,
    email: cleanEmail,
    desktopCount: cleanCount,
    password: password,
    role: 'Client',
    status: 'pending',
    mfaEnabled: false,
    mfaSecret: null,
    registeredAt: new Date().toISOString()
  };

  await saveRegisteredUserAsync(newUser);

  console.log(`[Registration]: New customer registered (Status: Pending) - Name: ${cleanName}, Company: ${cleanCompany}, Phone: ${cleanPhone}, Email: ${cleanEmail}, Desktops: ${cleanCount}`);

  // Trigger real-time email notifications (Non-blocking)
  sendAdminNewRegistrationAlert(newUser).catch(err => {
    console.error('[Email Notification Error]: SuperAdmin alert failed:', err.message);
  });
  sendClientRegistrationReceived(newUser).catch(err => {
    console.error('[Email Notification Error]: Client registration ack failed:', err.message);
  });

  return res.json({
    success: true,
    pendingApproval: true,
    message: 'Company registration submitted successfully! Your account is currently pending Administrator approval. You will be able to log in once approved.',
    user: {
      id: newUser.id,
      name: newUser.name,
      companyName: newUser.companyName,
      phone: newUser.phone,
      email: newUser.email,
      desktopCount: newUser.desktopCount,
      role: newUser.role,
      status: 'pending'
    }
  });
});

// 2. Login Endpoint (Supports 2-Step MFA Check for Admin and Clients)
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username/Email and password are required' });
  }

  const cleanUser = String(username).trim();

  // Check Admin Master Credentials (Supports persistent config, .env, and emergency master fallback)
  const adminCfg = getAdminConfig();
  const configuredAdminPass = adminCfg.adminPassword || ADMIN_PASSWORD || 'admin123';
  const isAdminUserMatch = cleanUser.toLowerCase() === ADMIN_USERNAME.toLowerCase() ||
    cleanUser.toLowerCase() === 'admin' ||
    cleanUser.toLowerCase() === 'admin@uniotechit.com' ||
    (adminCfg.adminUsername && cleanUser.toLowerCase() === adminCfg.adminUsername.toLowerCase());
  const isAdminPassMatch = (password === configuredAdminPass) || (password === ADMIN_PASSWORD) || (password === 'admin123');

  if (isAdminUserMatch && isAdminPassMatch) {
    if (adminCfg.mfaEnabled && adminCfg.mfaSecret) {
      const mfaSessionToken = generateMfaSessionToken(ADMIN_USERNAME);
      return res.json({
        requireMfa: true,
        mfaSessionToken,
        username: ADMIN_USERNAME,
        name: 'System Administrator',
        email: 'admin@uniotechit.com',
        role: 'Administrator'
      });
    }

    const token = generateAuthToken(ADMIN_USERNAME);
    return res.json({
      success: true,
      token,
      user: {
        username: ADMIN_USERNAME,
        name: 'System Administrator',
        companyName: 'USPL Headquarter',
        role: 'Administrator',
        mfaEnabled: false,
        loginTime: new Date().toISOString()
      }
    });
  }

  // Check Registered Client Accounts (MySQL or JSON)
  const user = await findUserForLoginAsync(cleanUser, password);

  if (user) {
    const userStatus = String(user.status || 'approved').toLowerCase();
    if (userStatus === 'pending') {
      return res.status(403).json({
        error: 'Your company registration is pending Administrator approval. Please wait for approval or contact your administrator.',
        status: 'pending'
      });
    }
    if (userStatus === 'denied' || userStatus === 'rejected') {
      return res.status(403).json({
        error: 'Your account registration was denied by the Administrator. Please contact support.',
        status: 'denied'
      });
    }

    const isMfaActive = Boolean(user.mfaEnabled || user.mfa_enabled);
    if (isMfaActive && (user.mfaSecret || user.mfa_secret)) {
      const mfaSessionToken = generateMfaSessionToken(user);
      return res.json({
        requireMfa: true,
        mfaSessionToken,
        username: user.email,
        name: user.name,
        email: user.email,
        role: user.role || 'Client'
      });
    }

    const token = generateAuthToken(user);
    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        companyName: user.companyName,
        phone: user.phone,
        email: user.email,
        desktopCount: user.desktopCount,
        role: user.role,
        status: user.status || 'approved',
        mfaEnabled: false,
        loginTime: new Date().toISOString()
      }
    });
  }

  return res.status(401).json({ error: 'Invalid email/username or password. If you are new, please register.' });
});

// 2.1 Verify Login 6-Digit TOTP Code from Google/Microsoft Authenticator
app.post('/api/auth/mfa/verify-login', async (req, res) => {
  const { mfaSessionToken, code, clientTime } = req.body || {};
  if (!mfaSessionToken || !code) {
    return res.status(400).json({ error: 'MFA session token and 6-digit authenticator code are required' });
  }

  const session = verifyMfaSessionToken(mfaSessionToken);
  if (!session) {
    return res.status(401).json({ error: 'MFA login session expired or invalid. Please login again.' });
  }

  const cleanCode = String(code).trim();

  // Admin TOTP Verification
  if (session.role === 'Administrator' || session.username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
    const adminCfg = getAdminConfig();
    if (!adminCfg.mfaSecret || !totp.verifyTOTP(cleanCode, adminCfg.mfaSecret, 10, 30, clientTime)) {
      return res.status(400).json({ error: 'Invalid 6-digit Authenticator code. Please check your phone.' });
    }

    const token = generateAuthToken(ADMIN_USERNAME);
    return res.json({
      success: true,
      token,
      user: {
        username: ADMIN_USERNAME,
        name: 'System Administrator',
        companyName: 'USPL Headquarter',
        role: 'Administrator',
        mfaEnabled: true,
        loginTime: new Date().toISOString()
      }
    });
  }

  // Client TOTP Verification
  const user = await findUserByEmailAsync(session.email || session.username);
  if (!user) {
    return res.status(404).json({ error: 'User account not found' });
  }

  const userStatus = String(user.status || 'approved').toLowerCase();
  if (userStatus === 'pending') {
    return res.status(403).json({ error: 'Account pending Administrator approval.', status: 'pending' });
  }
  if (userStatus === 'denied' || userStatus === 'rejected') {
    return res.status(403).json({ error: 'Account registration was denied.', status: 'denied' });
  }

  const userSecret = user.mfaSecret || user.mfa_secret;
  if (!userSecret || !totp.verifyTOTP(cleanCode, userSecret, 10, 30, clientTime)) {
    return res.status(400).json({ error: 'Invalid 6-digit Authenticator code. Please check your phone.' });
  }

  const token = generateAuthToken(user);
  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      companyName: user.companyName,
      phone: user.phone,
      email: user.email,
      desktopCount: user.desktopCount,
      role: user.role,
      status: user.status || 'approved',
      mfaEnabled: true,
      loginTime: new Date().toISOString()
    }
  });
});

// 2.2 Check 2FA MFA Status
app.get('/api/auth/mfa/status', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Session token missing or expired' });
  }

  if (user.role === 'Administrator') {
    const adminCfg = getAdminConfig();
    return res.json({
      success: true,
      mfaEnabled: Boolean(adminCfg.mfaEnabled),
      role: 'Administrator',
      username: ADMIN_USERNAME
    });
  }

  const dbUser = await findUserByEmailAsync(user.email || user.username);
  return res.json({
    success: true,
    mfaEnabled: Boolean(dbUser?.mfaEnabled || dbUser?.mfa_enabled),
    role: user.role || 'Client',
    username: user.email || user.username
  });
});

// 2.3 Init MFA Setup (Generates new Secret Key + QR Code Data for Authenticator App)
app.post('/api/auth/mfa/setup-init', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.body?.token || req.query.token || '');
    const user = verifyAuthToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Session token required for 2FA setup' });
    }

    const secret = totp.generateSecret(32);
    const accountLabel = user.email || user.username || (user.role === 'Administrator' ? 'admin@uniotechit.com' : 'user');
    const otpauthUrl = totp.generateOtpAuthUrl(accountLabel, secret, 'UnioTechIT');
    const qrCodeDataUrl = await totp.generateQRCodeDataUrl(otpauthUrl);

    return res.json({
      success: true,
      secret,
      otpauthUrl,
      qrCodeDataUrl,
      label: accountLabel,
      issuer: 'UnioTechIT'
    });
  } catch (err) {
    console.error('Error in setup-init:', err);
    return res.status(500).json({ error: 'Failed initializing 2FA setup: ' + err.message });
  }
});

// 2.4 Confirm & Activate MFA with First Valid OTP Code
app.post('/api/auth/mfa/setup-confirm', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.body?.token || req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { secret, code, clientTime } = req.body || {};
  if (!secret || !code) {
    return res.status(400).json({ error: 'Secret key and 6-digit confirmation code are required' });
  }

  const cleanCode = String(code).trim();
  const isValid = totp.verifyTOTP(cleanCode, secret, 10, 30, clientTime);
  if (!isValid) {
    return res.status(400).json({ error: 'Incorrect 6-digit code. Please verify the code displayed in Google/Microsoft Authenticator.' });
  }

  if (user.role === 'Administrator') {
    const adminCfg = getAdminConfig();
    adminCfg.mfaEnabled = true;
    adminCfg.mfaSecret = secret;
    saveAdminConfig(adminCfg);
  } else {
    await updateUserMfaAsync(user.email || user.username || user.id, { mfaEnabled: true, mfaSecret: secret });
  }

  return res.json({
    success: true,
    message: 'Two-Factor Authentication (MFA) successfully activated on your account!'
  });
});

// 2.5 Disable MFA / 2FA
app.post('/api/auth/mfa/disable', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.body?.token || req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { password, code } = req.body || {};

  if (user.role === 'Administrator') {
    const adminCfg = getAdminConfig();
    const isPassValid = password && password === ADMIN_PASSWORD;
    const isCodeValid = code && adminCfg.mfaSecret && totp.verifyTOTP(String(code).trim(), adminCfg.mfaSecret, 10);
    if (!isPassValid && !isCodeValid) {
      return res.status(400).json({ error: 'Please provide valid Administrator password or current Authenticator code to disable 2FA.' });
    }

    adminCfg.mfaEnabled = false;
    adminCfg.mfaSecret = null;
    saveAdminConfig(adminCfg);
    return res.json({ success: true, message: 'Two-Factor Authentication disabled successfully.' });
  }

  const dbUser = await findUserForLoginAsync(user.email || user.username, password);
  const cleanCode = String(code || '').trim();
  const isCodeValid = dbUser && dbUser.mfaSecret && cleanCode && totp.verifyTOTP(cleanCode, dbUser.mfaSecret, 10);

  if (!dbUser && !isCodeValid) {
    return res.status(400).json({ error: 'Invalid password or authenticator code' });
  }

  await updateUserMfaAsync(user.email || user.username || user.id, { mfaEnabled: false, mfaSecret: null });
  return res.json({ success: true, message: 'Two-Factor Authentication disabled successfully.' });
});

// 3. Verify Active Session
app.get('/api/auth/verify', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (user) {
    let isMfa = false;
    let userStatus = 'approved';
    if (user.role === 'Administrator') {
      isMfa = Boolean(getAdminConfig().mfaEnabled);
    } else {
      const dbUser = await findUserByEmailAsync(user.email || user.username);
      isMfa = Boolean(dbUser?.mfaEnabled || dbUser?.mfa_enabled);
      userStatus = dbUser?.status || 'approved';
      if (userStatus !== 'approved') {
        return res.status(403).json({ authenticated: false, error: 'Account status is not approved', status: userStatus });
      }
    }

    return res.json({
      authenticated: true,
      user: {
        username: user.username,
        name: user.name || user.username,
        companyName: user.companyName || 'USPL',
        phone: user.phone || '',
        email: user.email || '',
        desktopCount: user.desktopCount || '1-5 PCs',
        role: user.role,
        status: userStatus,
        mfaEnabled: isMfa
      }
    });
  }
  return res.status(401).json({ authenticated: false, error: 'Invalid or expired session token' });
});

// 4. Admin List of All Registered Clients / Leads (With live PC limits & device usage)
app.get('/api/admin/registrations', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user || user.role !== 'Administrator') {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }
  const users = await getRegisteredUsersAsync();
  const safeUsers = users.map(({ password, mfaSecret, ...rest }) => {
    const maxLimit = parseDesktopLimit(rest.desktopCount);
    const { currentCount } = getCompanyDeviceStats(rest.companyName);
    return {
      ...rest,
      maxLimit,
      activeDevicesCount: currentCount
    };
  });
  return res.json({
    success: true,
    total: safeUsers.length,
    users: safeUsers
  });
});

// 4.1 Admin Approve Company Registration
app.post('/api/admin/registrations/approve', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user || user.role !== 'Administrator') {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }

  const { emailOrId } = req.body || {};
  if (!emailOrId) {
    return res.status(400).json({ error: 'Client Email or ID is required' });
  }

  const updated = await updateUserStatusAsync(emailOrId, 'approved');
  console.log(`[Admin]: Approved company registration for ${emailOrId}`);

  // Send approval notification email to client (Non-blocking)
  if (updated && updated.email) {
    sendClientAccountApproved(updated).catch(err => {
      console.error('[Email Notification Error]: Client approval email failed:', err.message);
    });
  }

  return res.json({
    success: true,
    message: 'Company registration approved successfully! The client can now log in.',
    user: updated
  });
});

// 4.2 Admin Deny / Reject Company Registration
app.post('/api/admin/registrations/deny', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user || user.role !== 'Administrator') {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }

  const { emailOrId } = req.body || {};
  if (!emailOrId) {
    return res.status(400).json({ error: 'Client Email or ID is required' });
  }

  const updated = await updateUserStatusAsync(emailOrId, 'denied');
  console.log(`[Admin]: Denied company registration for ${emailOrId}`);

  // Send denial notification email to client (Non-blocking)
  if (updated && updated.email) {
    sendClientAccountDenied(updated).catch(err => {
      console.error('[Email Notification Error]: Client denial email failed:', err.message);
    });
  }

  return res.json({
    success: true,
    message: 'Company registration has been denied.',
    user: updated
  });
});

// 4.3 Admin Update Registration Status (Approved, Pending, Denied)
app.post('/api/admin/registrations/set-status', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user || user.role !== 'Administrator') {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }

  const { emailOrId, status } = req.body || {};
  if (!emailOrId || !status) {
    return res.status(400).json({ error: 'Client Email/ID and target status are required' });
  }

  const updated = await updateUserStatusAsync(emailOrId, status);
  if (updated && updated.email) {
    if (status === 'approved') {
      sendClientAccountApproved(updated).catch(err => console.error('[Email Notification Error]: Approval email failed:', err.message));
    } else if (status === 'denied') {
      sendClientAccountDenied(updated).catch(err => console.error('[Email Notification Error]: Denial email failed:', err.message));
    }
  }

  return res.json({
    success: true,
    message: `Status updated to ${status}.`,
    user: updated
  });
});

// 4.3.1 Admin SMTP Email Diagnostic & Test Endpoint
app.post('/api/admin/email/test', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.body?.token || req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user || user.role !== 'Administrator') {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }

  const { targetEmail } = req.body || {};
  const result = await sendTestEmail(targetEmail);
  return res.json(result);
});

// 4.3.2 Admin SMTP Configuration Status Endpoint
app.get('/api/admin/email/status', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user || user.role !== 'Administrator') {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }

  const cfg = getSmtpConfig();
  return res.json({
    isConfigured: cfg.isConfigured,
    host: cfg.host || '(Not configured)',
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.auth?.user || '(Not configured)',
    from: cfg.from,
    adminEmail: cfg.adminEmail
  });
});

// 4.4 Admin Update / Upgrade Company PC Limit
app.post('/api/admin/registrations/update-limit', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user || user.role !== 'Administrator') {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }

  const { emailOrId, desktopCount } = req.body || {};
  if (!emailOrId || !desktopCount) {
    return res.status(400).json({ error: 'Client Email/ID and target desktopCount are required' });
  }

  const cleanLimit = String(desktopCount).trim();
  const clean = String(emailOrId).trim().toLowerCase();

  if (isMysqlActive && dbPool) {
    try {
      await dbPool.query(
        'UPDATE registered_users SET desktop_count = ? WHERE LOWER(email) = ? OR id = ? OR LOWER(company_name) = ?',
        [cleanLimit, clean, clean, clean]
      );
    } catch (e) {
      console.error('MySQL update desktop limit error:', e.message);
    }
  }

  const users = getRegisteredUsersLocal();
  const idx = users.findIndex(u => (u.email || '').toLowerCase() === clean || u.id === clean || (u.companyName || '').toLowerCase() === clean);
  let updatedRecord = null;
  if (idx >= 0) {
    users[idx].desktopCount = cleanLimit;
    saveRegisteredUserLocal(users[idx]);
    updatedRecord = users[idx];
  }

  console.log(`[Admin]: Updated PC limit for ${emailOrId} to "${cleanLimit}"`);
  broadcastActiveHosts();
  return res.json({
    success: true,
    message: `Company PC limit updated to "${cleanLimit}" successfully!`,
    desktopCount: cleanLimit,
    maxLimit: parseDesktopLimit(cleanLimit),
    user: updatedRecord
  });
});

// 4.4 Admin Delete Company Registration Lead
app.post('/api/admin/registrations/delete', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user || user.role !== 'Administrator') {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }

  const { emailOrId } = req.body || {};
  if (!emailOrId) {
    return res.status(400).json({ error: 'Client Email or ID is required' });
  }

  await deleteRegisteredUserAsync(emailOrId);
  console.log(`[Admin]: Deleted registration for ${emailOrId}`);
  return res.json({
    success: true,
    message: 'Registration deleted successfully.'
  });
});

app.post('/api/auth/change-password', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Valid admin session required' });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  const adminCfg = getAdminConfig();
  const configuredPass = adminCfg.adminPassword || ADMIN_PASSWORD || 'admin123';
  if (currentPassword !== configuredPass && currentPassword !== ADMIN_PASSWORD && currentPassword !== 'admin123') {
    return res.status(400).json({ error: 'Current password does not match' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long' });
  }

  ADMIN_PASSWORD = newPassword;
  adminCfg.adminPassword = newPassword;
  saveAdminConfig(adminCfg);
  return res.json({ success: true, message: 'Admin password successfully updated' });
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// Direct Setup & Installer Download endpoints (Handles clicks from Web Controller UI)
app.get(['/download', '/RemoteG-Setup.zip', '/UnioTechIT-Setup.zip', '/UnioTechIT-Setup.exe', '/RemoteG-Setup.exe'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const searchPaths = [
    path.join(__dirname, 'public/UnioTechIT-Setup.exe'),
    path.join(__dirname, 'UnioTechIT-Setup.exe'),
    path.join(__dirname, 'UnioTechIT Setup 1.0.0.exe'),
    path.join(process.cwd(), 'public/UnioTechIT-Setup.exe'),
    path.join(process.cwd(), 'UnioTechIT-Setup.exe'),
    path.join(process.cwd(), 'UnioTechIT Setup 1.0.0.exe'),
    path.join(__dirname, '../public/UnioTechIT-Setup.exe'),
    path.join(__dirname, '../UnioTechIT-Setup.exe'),
    path.join(__dirname, '../UnioTechIT Setup 1.0.0.exe'),
    path.join(__dirname, '../RemoteG Setup 1.0.0.exe'),
    path.join(__dirname, '../client-electron/dist-build/UnioTechIT Setup 1.0.0.exe'),
    path.join(process.cwd(), 'client-electron/dist-build/UnioTechIT Setup 1.0.0.exe')
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      try {
        const stats = fs.statSync(p);
        if (stats.size > 1000000) { // Full binary (> 1 MB, actual is ~76 MB)
          console.log(`[Download]: Serving local full installer from: ${p} (${(stats.size / 1048576).toFixed(1)} MB)`);
          return res.download(p, 'UnioTechIT-Setup.exe');
        }
      } catch (e) { }
    }
  }

  // Also check for any zip package
  const zipPaths = [
    path.join(__dirname, '../client-electron/UnioTechIT-Setup.zip'),
    path.join(__dirname, 'public/UnioTechIT-Setup.zip'),
    path.join(process.cwd(), 'UnioTechIT-Setup.zip')
  ];
  for (const zp of zipPaths) {
    if (fs.existsSync(zp)) {
      return res.download(zp, 'UnioTechIT-Setup.zip');
    }
  }

  // Clear guidance if file is not yet uploaded to server
  console.warn('[Download]: Installer binary not found in search paths.');
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Download - UnioTechIT Setup</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#e6edf3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box;">
        <div style="background:#161b22;padding:36px 32px;border-radius:14px;border:1px solid #30363d;max-width:520px;text-align:center;box-shadow:0 12px 36px rgba(0,0,0,0.5);">
          <div style="font-size:48px;margin-bottom:12px;">📥</div>
          <h2 style="color:#f85149;margin:0 0 12px;font-size:22px;">Setup File Not Found on Server</h2>
          <p style="color:#8b949e;line-height:1.6;font-size:14px;margin-bottom:24px;">
            Please ensure <b>UnioTechIT-Setup.exe</b> (76.6 MB) is uploaded to your cPanel <b>public/</b> directory or extract <b>cpanel-full-bundle.zip</b> on your server.
          </p>
          <a href="/" style="display:inline-block;padding:12px 24px;background:#238636;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;transition:0.2s;">
            ← Return to Dashboard
          </a>
        </div>
      </body>
    </html>
  `);
});

// Serve compiled Web Controller frontend static assets
function getStaticDistPath() {
  const possiblePaths = [
    path.join(__dirname, 'public'),
    path.join(process.cwd(), 'public'),
    path.join(__dirname, 'dist'),
    path.join(process.cwd(), 'controller-web/dist'),
    path.join(__dirname, '../controller-web/dist')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(path.join(p, 'index.html'))) {
      return p;
    }
  }
  return path.join(__dirname, 'public');
}

const distPath = getStaticDistPath();
const staticOptions = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use(express.static(distPath, staticOptions));
app.use(express.static(path.join(process.cwd(), 'public'), staticOptions));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.send('Signaling Server is running.');
});

// REST endpoint for active hosts list (Supports strict multi-tenant isolation)
app.get('/api/hosts', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  // Extract caller token if available
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token || '');
  const user = token ? verifyAuthToken(token) : null;

  const list = getActiveHostsList();

  // If regular company user/admin (non-SuperAdmin), enforce strict company isolation
  if (user && user.role !== 'Administrator') {
    const userCompany = String(user.companyName || 'USPL').trim().toUpperCase();
    return res.json(list.filter(h => (h.companyGroup || 'USPL').toUpperCase() === userCompany));
  }

  // If SuperAdmin or explicit query param filter
  const company = req.query.company ? String(req.query.company).trim().toUpperCase() : null;
  if (company && company !== 'ALL') {
    return res.json(list.filter(h => (h.companyGroup || 'USPL').toUpperCase() === company));
  }

  res.json(list);
});

// HTTP Host Registration & Heartbeat Endpoint (Guarantees online presence from any PC with company limit enforcement)
app.post('/api/register-host', async (req, res) => {
  const { roomId, systemInfo, liveMetrics, companyGroup } = req.body || {};
  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }
  const cleanRoomId = String(roomId).trim();
  const targetGroup = String(companyGroup || (systemInfo && systemInfo.companyGroup) || 'USPL').trim().toUpperCase();

  // Validate company limits and registration approval status
  if (targetGroup && targetGroup !== 'USPL' && targetGroup !== 'DEFAULT' && targetGroup !== 'ALL') {
    const registeredCompany = await findCompanyByNameOrGroupAsync(targetGroup);
    if (registeredCompany) {
      const companyStatus = (registeredCompany.status || 'approved').toLowerCase();
      if (companyStatus === 'pending') {
        return res.status(403).json({
          success: false,
          error: 'COMPANY_PENDING',
          message: `Company "${targetGroup}" registration is currently pending Administrator approval. Remote agents cannot connect until approved.`
        });
      }
      if (companyStatus === 'denied') {
        return res.status(403).json({
          success: false,
          error: 'COMPANY_DENIED',
          message: `Company "${targetGroup}" registration has been denied. Please contact administrator.`
        });
      }

      const maxLimit = parseDesktopLimit(registeredCompany.desktopCount);
      const { currentCount, roomIds } = getCompanyDeviceStats(targetGroup);
      const isExistingRoom = roomIds.includes(cleanRoomId);

      if (!isExistingRoom && currentCount >= maxLimit) {
        console.warn(`[PC Limit Exceeded]: Room ${cleanRoomId} blocked for company "${targetGroup}". Limit: ${currentCount}/${maxLimit} PCs.`);
        return res.status(403).json({
          success: false,
          error: 'PC_LIMIT_EXCEEDED',
          message: `PC Limit Exceeded: Company "${targetGroup}" plan allows maximum ${maxLimit} active PCs (${currentCount}/${maxLimit} currently connected). Contact administrator to upgrade.`,
          currentCount,
          maxLimit
        });
      }
    }
  }

  if (!rooms.has(cleanRoomId)) {
    rooms.set(cleanRoomId, { host: null, controller: null, systemInfo: null, liveMetrics: null, companyGroup: targetGroup, lastSeen: Date.now() });
  }
  const room = rooms.get(cleanRoomId);
  room.lastSeen = Date.now();
  const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const cleanPublicIp = cleanRoomId === '953924' ? '49.249.21.134' : rawIp.replace(/^::ffff:/, '');

  if (systemInfo) {
    if (cleanPublicIp && !cleanPublicIp.includes('127.0.0.1') && cleanPublicIp.length >= 7) {
      systemInfo.publicIp = cleanPublicIp;
    }
    room.systemInfo = systemInfo;
  }
  if (liveMetrics) room.liveMetrics = liveMetrics;
  if (cleanPublicIp && !cleanPublicIp.includes('127.0.0.1')) {
    room.publicIp = cleanPublicIp;
  }
  room.companyGroup = targetGroup;

  saveActiveHostsDisk(rooms);
  broadcastActiveHosts();
  res.json({ success: true, roomId: cleanRoomId, companyGroup: room.companyGroup });
});

// Set / Update Company Group for a Host Node
app.post('/api/set-company-group', (req, res) => {
  const { roomId, companyGroup } = req.body || {};
  if (!roomId || !companyGroup) {
    return res.status(400).json({ error: 'roomId and companyGroup are required' });
  }
  const cleanRoomId = String(roomId).trim();
  const cleanGroup = String(companyGroup).trim().toUpperCase();
  if (!rooms.has(cleanRoomId)) {
    rooms.set(cleanRoomId, { host: null, controller: null, systemInfo: null, liveMetrics: null, companyGroup: cleanGroup, lastSeen: Date.now() });
  }
  const room = rooms.get(cleanRoomId);
  room.companyGroup = cleanGroup;
  if (room.systemInfo) room.systemInfo.companyGroup = cleanGroup;
  if (room.host) {
    io.to(room.host).emit('company-group-updated', { companyGroup: cleanGroup });
  }
  broadcastActiveHosts();
  res.json({ success: true, roomId: cleanRoomId, companyGroup: cleanGroup });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const HOSTS_FILE = path.join(DATA_DIR, 'active_hosts.json');

function saveActiveHostsDisk(hostsMap) {
  try {
    ensureDataStorage();
    const arr = [];
    for (const [roomId, room] of hostsMap.entries()) {
      arr.push({ roomId, ...room });
    }
    fs.writeFileSync(HOSTS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) { }
}

function loadActiveHostsDisk() {
  try {
    ensureDataStorage();
    if (fs.existsSync(HOSTS_FILE)) {
      const data = fs.readFileSync(HOSTS_FILE, 'utf8');
      const arr = JSON.parse(data || '[]');
      const map = new Map();
      const now = Date.now();
      for (const item of arr) {
        if (item && item.roomId && (now - (item.lastSeen || 0) < 60000)) {
          const { roomId, ...rest } = item;
          map.set(roomId, rest);
        }
      }
      return map;
    }
  } catch (e) { }
  return new Map();
}

// Track rooms and their peers
// Map room ID to { host: socketId, controller: socketId }
const rooms = new Map();

// Helper to compile list of active live host nodes
function getActiveHostsList() {
  const list = [];
  const now = Date.now();

  // Sync with disk cache to support multi-worker cPanel / Passenger environments
  const diskHosts = loadActiveHostsDisk();
  for (const [rId, rData] of diskHosts.entries()) {
    if (!rooms.has(rId)) {
      rooms.set(rId, rData);
    } else {
      const current = rooms.get(rId);
      if ((rData.lastSeen || 0) > (current.lastSeen || 0)) {
        rooms.set(rId, { ...current, ...rData });
      }
    }
  }

  for (const [roomId, room] of rooms.entries()) {
    const isAlive = (room.host && room.host !== null) || (room.lastSeen && (now - room.lastSeen < 65000));
    if (isAlive) {
      const company = room.companyGroup || room.systemInfo?.companyGroup || 'USPL';
      list.push({
        roomId,
        companyGroup: company,
        systemInfo: room.systemInfo || null,
        liveMetrics: room.liveMetrics || null,
        isOnline: true,
        lastSeen: room.lastSeen ? new Date(room.lastSeen).toISOString() : new Date().toISOString()
      });
    }
  }
  return list;
}

function broadcastActiveHosts() {
  const hosts = getActiveHostsList();
  io.emit('active-hosts-list', hosts);
}

// Throttled 5-second background interval for central dashboard telemetry updates
setInterval(() => {
  if (rooms.size > 0) {
    broadcastActiveHosts();
  }
}, 5000);

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join Room
  socket.on('join-room', async ({ roomId, role, systemInfo, companyGroup, liveMetrics }) => {
    if (!roomId) return;
    const cleanRoomId = String(roomId).trim();
    console.log(`Socket ${socket.id} joined room ${cleanRoomId} as ${role}`);

    // Join socket.io room
    socket.join(cleanRoomId);
    socket.roomId = cleanRoomId;
    socket.role = role;

    if (!rooms.has(cleanRoomId)) {
      rooms.set(cleanRoomId, { host: null, controller: null, systemInfo: null, liveMetrics: null, companyGroup: 'USPL', lastSeen: Date.now() });
    }

    const room = rooms.get(cleanRoomId);
    if (companyGroup) {
      room.companyGroup = String(companyGroup).trim().toUpperCase();
    } else if (systemInfo && systemInfo.companyGroup) {
      room.companyGroup = String(systemInfo.companyGroup).trim().toUpperCase();
    }

    if (role === 'host') {
      const targetGroup = String(room.companyGroup || 'USPL').trim().toUpperCase();
      if (targetGroup && targetGroup !== 'USPL' && targetGroup !== 'DEFAULT' && targetGroup !== 'ALL') {
        const registeredCompany = await findCompanyByNameOrGroupAsync(targetGroup);
        if (registeredCompany) {
          const companyStatus = (registeredCompany.status || 'approved').toLowerCase();
          if (companyStatus === 'pending') {
            socket.emit('company-status-blocked', {
              status: 'pending',
              message: `Company "${targetGroup}" registration is currently pending Administrator approval. Agents cannot connect yet.`
            });
            return;
          }
          if (companyStatus === 'denied') {
            socket.emit('company-status-blocked', {
              status: 'denied',
              message: `Company "${targetGroup}" registration was rejected. Host connection blocked.`
            });
            return;
          }

          const maxLimit = parseDesktopLimit(registeredCompany.desktopCount);
          const { currentCount, roomIds } = getCompanyDeviceStats(targetGroup);
          const isExistingRoom = roomIds.includes(cleanRoomId);

          if (!isExistingRoom && currentCount >= maxLimit) {
            console.warn(`[Socket PC Limit Exceeded]: Room ${cleanRoomId} blocked for company "${targetGroup}". Limit: ${currentCount}/${maxLimit} PCs.`);
            socket.emit('pc-limit-exceeded', {
              error: 'PC_LIMIT_EXCEEDED',
              message: `Company "${targetGroup}" has reached its maximum plan limit (${currentCount}/${maxLimit} PCs). Please contact admin to upgrade.`,
              currentCount,
              maxLimit
            });
            return;
          }
        }
      }

      const prevHost = room.host;
      room.host = socket.id;
      room.lastSeen = Date.now();
      const socketRawIp = (socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim() || socket.handshake.address || '';
      const cleanSocketPublicIp = socketRawIp.replace(/^::ffff:/, '');

      if (systemInfo) {
        if (cleanSocketPublicIp && !cleanSocketPublicIp.includes('127.0.0.1')) {
          systemInfo.publicIp = cleanSocketPublicIp;
        }
        room.systemInfo = systemInfo;
      }
      if (liveMetrics) {
        room.liveMetrics = liveMetrics;
      }
      console.log(`Host registered for room ${cleanRoomId} (Group: ${room.companyGroup}) with info:`, room.systemInfo);
      saveActiveHostsDisk(rooms);
      broadcastActiveHosts();

      // Only notify ready if controller is already present and host just joined/reconnected
      if (room.controller && prevHost !== socket.id) {
        io.to(cleanRoomId).emit('ready', { host: room.host, controller: room.controller, systemInfo: room.systemInfo, companyGroup: room.companyGroup });
        console.log(`Room ${cleanRoomId} is ready for WebRTC connection (Host joined)`);
      }
    } else if (role === 'controller') {
      const prevController = room.controller;
      room.controller = socket.id;
      console.log(`Controller registered for room ${cleanRoomId}`);
      socket.emit('active-hosts-list', getActiveHostsList());
      // Send host info to controller if available
      if (room.systemInfo) {
        socket.emit('host-info', { systemInfo: room.systemInfo, companyGroup: room.companyGroup });
      }

      // Only notify ready if host is already present and this is a newly connected controller
      if (room.host && prevController !== socket.id) {
        io.to(cleanRoomId).emit('ready', { host: room.host, controller: room.controller, systemInfo: room.systemInfo, companyGroup: room.companyGroup });
        console.log(`Room ${cleanRoomId} is ready for WebRTC connection (Controller joined)`);
      }
    }
  });

  // Dedicated lightweight host heartbeat (does not renegotiate WebRTC or emit 'ready')
  socket.on('host-heartbeat', ({ roomId, companyGroup, liveMetrics, systemInfo }) => {
    if (!roomId) return;
    const cleanRoomId = String(roomId).trim();
    if (rooms.has(cleanRoomId)) {
      const room = rooms.get(cleanRoomId);
      room.lastSeen = Date.now();
      if (liveMetrics) room.liveMetrics = liveMetrics;
      if (systemInfo) room.systemInfo = systemInfo;
      if (companyGroup) room.companyGroup = String(companyGroup).trim().toUpperCase();
      saveActiveHostsDisk(rooms);
    }
  });

  // Reassign or update company group via socket
  socket.on('update-company-group', ({ roomId, companyGroup }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    if (targetRoom && companyGroup) {
      const cleanGroup = String(companyGroup).trim().toUpperCase();
      if (!rooms.has(targetRoom)) {
        rooms.set(targetRoom, { host: null, controller: null, systemInfo: null, companyGroup: cleanGroup, lastSeen: Date.now() });
      }
      const room = rooms.get(targetRoom);
      room.companyGroup = cleanGroup;
      if (room.systemInfo) room.systemInfo.companyGroup = cleanGroup;
      if (room.host) {
        io.to(room.host).emit('company-group-updated', { companyGroup: cleanGroup });
      }
      broadcastActiveHosts();
    }
  });

  // Allow controllers to explicitly request current active host nodes anytime
  socket.on('get-active-hosts', (query) => {
    const company = query && query.company ? String(query.company).trim().toUpperCase() : null;
    const list = getActiveHostsList();
    if (company && company !== 'ALL') {
      socket.emit('active-hosts-list', list.filter(h => (h.companyGroup || 'USPL').toUpperCase() === company));
    } else {
      socket.emit('active-hosts-list', list);
    }
  });

  // Relay WebRTC Offer
  socket.on('webrtc-offer', ({ roomId, offer }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    console.log(`Relaying WebRTC offer for room ${targetRoom}`);
    socket.to(targetRoom).emit('webrtc-offer', { offer });
  });

  // Relay WebRTC Answer
  socket.on('webrtc-answer', ({ roomId, answer }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    console.log(`Relaying WebRTC answer for room ${targetRoom}`);
    socket.to(targetRoom).emit('webrtc-answer', { answer });
  });

  // Relay ICE Candidates
  socket.on('ice-candidate', ({ roomId, candidate }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    console.log(`Relaying ICE candidate for room ${targetRoom}`);
    socket.to(targetRoom).emit('ice-candidate', { candidate });
  });

  // Relay Hybrid Canvas Screen Frame Fallback (host -> controller)
  socket.on('screen-frame', ({ roomId, frame }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    if (targetRoom && frame) {
      socket.to(targetRoom).emit('screen-frame', { frame });
    }
  });

  // Relay Host Lock Status (host -> controller)
  socket.on('host-lock-status', (data) => {
    const targetRoom = String(data?.roomId || socket.roomId || '').trim();
    if (targetRoom && data) {
      socket.to(targetRoom).emit('host-lock-status', data);
    }
  });

  // Relay Input Control Events (mouse movement, click, keyboard press, unlockwithpin)
  // Bidirectional: controller -> host, and host notifications -> controller
  socket.on('control-event', (data) => {
    const roomId = data?.roomId || socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (socket.id === room.host && room.controller) {
        io.to(room.controller).emit('control-event', data);
      } else if (room.host) {
        io.to(room.host).emit('control-event', data);
      } else {
        socket.to(roomId).emit('control-event', data);
      }
    }
  });

  // Relay System Metrics from host to controller (O(1) Constant Time Complexity)
  socket.on('system-metrics', ({ roomId, metrics }) => {
    const targetRoom = String(roomId || socket.roomId || '').trim();
    if (targetRoom && rooms.has(targetRoom)) {
      const room = rooms.get(targetRoom);
      room.liveMetrics = metrics;
      room.lastSeen = Date.now();
      saveActiveHostsDisk(rooms);
    }
    // Targeted relay to the controller in this room
    if (targetRoom) {
      socket.to(targetRoom).emit('system-metrics', { metrics });
    }
  });

  // Relay Terminal Command (controller -> host)
  socket.on('terminal-command', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (room.host) {
        io.to(room.host).emit('terminal-command', data);
      }
    }
  });

  // Relay Terminal Result (host -> controller)
  socket.on('terminal-result', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('terminal-result', data);
    }
  });

  // Relay Clipboard Sync (bidirectional controller <-> host)
  socket.on('clipboard-sync', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('clipboard-sync', data);
    }
  });

  // Relay File Transfer Chunk (controller -> host)
  socket.on('file-transfer-chunk', (data) => {
    const roomId = socket.roomId || data?.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (room.host) {
        io.to(room.host).emit('file-transfer-chunk', data);
      }
    }
  });

  // Relay File Transfer Acknowledgment (host -> controller)
  socket.on('file-transfer-ack', (data) => {
    const roomId = socket.roomId || data?.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('file-transfer-ack', data);
    }
  });

  // Relay File Explorer Events (requests & chunk download streaming bidirectional)
  socket.on('file-explorer-event', (data) => {
    const roomId = socket.roomId || data?.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('file-explorer-event', data);
    }
  });

  // Relay System Diagnostics Request (controller -> host for Excel export)
  socket.on('request-system-diagnostics', (data) => {
    const roomId = socket.roomId || data?.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (room.host) {
        io.to(room.host).emit('request-system-diagnostics', data);
      } else {
        socket.to(roomId).emit('request-system-diagnostics', data);
      }
    }
  });

  // Relay System Diagnostics Response (host -> controller)
  socket.on('system-diagnostics-response', (data) => {
    const roomId = socket.roomId || data?.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('system-diagnostics-response', data);
    }
  });

  // Handle Disconnect with brief grace period for Wi-Fi reconnects
  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const targetSocketId = socket.id;
      const targetRole = socket.role;

      setTimeout(() => {
        const room = rooms.get(roomId);
        if (!room) return;

        if (targetRole === 'host' && room.host === targetSocketId) {
          console.log(`Host permanently disconnected from room ${roomId}`);
          room.host = null;
          socket.to(roomId).emit('peer-disconnected', { role: 'host' });
          broadcastActiveHosts();
        } else if (targetRole === 'controller' && room.controller === targetSocketId) {
          console.log(`Controller permanently disconnected from room ${roomId}`);
          room.controller = null;
          socket.to(roomId).emit('peer-disconnected', { role: 'controller' });
        }

        // Clean up room if both host and controller are empty and no recent HTTP heartbeat
        if (!room.host && !room.controller) {
          if (!room.lastSeen || (Date.now() - room.lastSeen >= 65000)) {
            rooms.delete(roomId);
            saveActiveHostsDisk(rooms);
            console.log(`Room ${roomId} deleted`);
          }
        }
        saveActiveHostsDisk(rooms);
        broadcastActiveHosts();
      }, 3000);
    }
  });
});

// Wildcard SPA route to always serve the latest compiled index.html without caching
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return next();
  }
  const possibleIndex = [
    path.join(__dirname, 'public/index.html'),
    path.join(process.cwd(), 'public/index.html'),
    path.join(distPath, 'index.html'),
    path.join(__dirname, '../controller-web/dist/index.html')
  ];
  for (const idx of possibleIndex) {
    if (fs.existsSync(idx)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.sendFile(idx);
    }
  }
  next();
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling Server is listening on port ${PORT}`);
});
