const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const logger = require('../utils/logger');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'appeals.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrency and durability
db.exec('PRAGMA journal_mode = WAL;');

// Initialize tables and indexes
db.exec(`
  CREATE TABLE IF NOT EXISTS appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appeal_code TEXT UNIQUE,
    user_id TEXT NOT NULL,
    user_tag TEXT NOT NULL,
    ign TEXT NOT NULL,
    age_timezone TEXT NOT NULL,
    reason TEXT NOT NULL,
    experience TEXT NOT NULL,
    screenshot_url TEXT DEFAULT NULL,
    gear_score INTEGER DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    permanent_block INTEGER NOT NULL DEFAULT 0,
    channel_id TEXT DEFAULT NULL,
    message_id TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_appeals_user_status ON appeals(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_appeals_message_id ON appeals(message_id);

  CREATE TABLE IF NOT EXISTS appeal_user_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    blocked_by TEXT NOT NULL,
    blocked_at INTEGER NOT NULL,
    unblocked_by TEXT DEFAULT NULL,
    unblocked_at INTEGER DEFAULT NULL,
    unblock_reason TEXT DEFAULT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_appeal_user_blocks_active
    ON appeal_user_blocks(user_id)
    WHERE unblocked_at IS NULL;

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appeal_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    vote_type TEXT NOT NULL CHECK(vote_type IN ('SUPPORT', 'AGAINST')),
    voted_at INTEGER NOT NULL,
    UNIQUE(appeal_id, user_id),
    FOREIGN KEY (appeal_id) REFERENCES appeals(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_votes_appeal ON votes(appeal_id);

  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appeal_id INTEGER NOT NULL,
    recipient_user_id TEXT NOT NULL,
    warning_message TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'SENT',
    FOREIGN KEY (appeal_id) REFERENCES appeals(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_warnings_appeal ON warnings(appeal_id);
`);

// Safe Schema Migration for Appeals (Tahap 3 & Format Revisi)
const existingColumns = db.prepare('PRAGMA table_info(appeals);').all();
const colNames = new Set(existingColumns.map((col) => col.name));

if (!colNames.has('reviewed_by')) {
  db.exec('ALTER TABLE appeals ADD COLUMN reviewed_by TEXT DEFAULT NULL;');
}
if (!colNames.has('reviewed_at')) {
  db.exec('ALTER TABLE appeals ADD COLUMN reviewed_at INTEGER DEFAULT NULL;');
}
if (!colNames.has('rejection_reason')) {
  db.exec('ALTER TABLE appeals ADD COLUMN rejection_reason TEXT DEFAULT NULL;');
}
if (!colNames.has('roblox_username')) {
  db.exec('ALTER TABLE appeals ADD COLUMN roblox_username TEXT DEFAULT NULL;');
}
if (!colNames.has('rules_agreed')) {
  db.exec('ALTER TABLE appeals ADD COLUMN rules_agreed INTEGER DEFAULT 1;');
}
if (!colNames.has('extra_info')) {
  db.exec('ALTER TABLE appeals ADD COLUMN extra_info TEXT DEFAULT NULL;');
}
if (!colNames.has('roblox_experience')) {
  db.exec('ALTER TABLE appeals ADD COLUMN roblox_experience TEXT DEFAULT NULL;');
}
if (!colNames.has('vote_ends_at')) {
  db.exec('ALTER TABLE appeals ADD COLUMN vote_ends_at INTEGER DEFAULT NULL;');
}
if (!colNames.has('member_rating')) {
  db.exec('ALTER TABLE appeals ADD COLUMN member_rating TEXT DEFAULT NULL;');
}
if (!colNames.has('gear_score')) {
  db.exec('ALTER TABLE appeals ADD COLUMN gear_score INTEGER DEFAULT NULL;');
}
if (!colNames.has('permanent_block')) {
  db.exec('ALTER TABLE appeals ADD COLUMN permanent_block INTEGER NOT NULL DEFAULT 0;');
}

db.exec(`
  INSERT INTO appeal_user_blocks (user_id, reason, blocked_by, blocked_at)
  SELECT a.user_id,
         COALESCE(NULLIF(a.rejection_reason, ''), 'Existing permanent Gear Score mismatch block'),
         COALESCE(a.reviewed_by, 'system'),
         COALESCE(a.reviewed_at, a.created_at)
  FROM appeals a
  WHERE a.permanent_block = 1
    AND a.id = (
      SELECT MAX(previous.id)
      FROM appeals previous
      WHERE previous.user_id = a.user_id AND previous.permanent_block = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM appeal_user_blocks existing WHERE existing.user_id = a.user_id
    );
`);

// Prepared Statements for Appeals
const stmtGetActiveByUser = db.prepare(`
  SELECT * FROM appeals 
  WHERE user_id = ? AND status = 'PENDING_REVIEW' 
  LIMIT 1
`);

// Ambil pengajuan terbaru user apapun statusnya (untuk cooldown)
const stmtGetLatestByUser = db.prepare(`
  SELECT * FROM appeals 
  WHERE user_id = ? 
  ORDER BY created_at DESC 
  LIMIT 1
`);

const stmtGetPermanentBlockByUser = db.prepare(`
  SELECT * FROM appeal_user_blocks
  WHERE user_id = ? AND unblocked_at IS NULL
  ORDER BY blocked_at DESC
  LIMIT 1
`);

const stmtInsertAppealUserBlock = db.prepare(`
  INSERT OR IGNORE INTO appeal_user_blocks (user_id, reason, blocked_by, blocked_at)
  VALUES (?, ?, ?, ?)
`);

const stmtUnblockAppealUser = db.prepare(`
  UPDATE appeal_user_blocks
  SET unblocked_by = ?, unblocked_at = ?, unblock_reason = ?
  WHERE user_id = ? AND unblocked_at IS NULL
`);

const stmtInsertAppeal = db.prepare(`
  INSERT INTO appeals (
    appeal_code, user_id, user_tag, ign, age_timezone, 
    reason, experience, screenshot_url, gear_score, status, created_at, updated_at,
    roblox_username, rules_agreed, extra_info, roblox_experience, vote_ends_at, member_rating
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtUpdateCode = db.prepare(`
  UPDATE appeals 
  SET appeal_code = ? 
  WHERE id = ?
`);

const stmtUpdateMessage = db.prepare(`
  UPDATE appeals 
  SET channel_id = ?, message_id = ?, updated_at = ? 
  WHERE id = ?
`);

const stmtUpdateScreenshot = db.prepare(`
  UPDATE appeals
  SET screenshot_url = ?, updated_at = ?
  WHERE id = ?
`);

const stmtDeleteUnsentAppeal = db.prepare(`
  DELETE FROM appeals
  WHERE id = ? AND status = 'PENDING_REVIEW' AND channel_id IS NULL AND message_id IS NULL
`);

const stmtReviewAppeal = db.prepare(`
  UPDATE appeals 
  SET status = ?, reviewed_by = ?, reviewed_at = ?, rejection_reason = ?, permanent_block = ?, updated_at = ?
  WHERE id = ? AND status = 'PENDING_REVIEW'
`);

const stmtGetById = db.prepare(`
  SELECT * FROM appeals WHERE id = ?
`);

const stmtGetByCode = db.prepare(`
  SELECT * FROM appeals WHERE appeal_code = ?
`);

const stmtGetByMessageId = db.prepare(`
  SELECT * FROM appeals WHERE message_id = ?
`);

const stmtSearchAppealsByRoblox = db.prepare(`
  SELECT * FROM appeals 
  WHERE LOWER(roblox_username) = LOWER(?) OR LOWER(ign) = LOWER(?)
  ORDER BY created_at DESC
`);

const stmtSearchAppealsByRobloxFuzzy = db.prepare(`
  SELECT * FROM appeals 
  WHERE LOWER(roblox_username) LIKE LOWER(?) OR LOWER(ign) LIKE LOWER(?)
  ORDER BY created_at DESC
  LIMIT 10
`);

// Prepared Statements for Community Votes
const stmtGetUserVote = db.prepare(`
  SELECT vote_type FROM votes 
  WHERE appeal_id = ? AND user_id = ?
`);

const stmtUpsertVote = db.prepare(`
  INSERT INTO votes (appeal_id, user_id, vote_type, voted_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(appeal_id, user_id) DO UPDATE SET
    vote_type = excluded.vote_type,
    voted_at = excluded.voted_at
`);

const stmtGetVoteCounts = db.prepare(`
  SELECT 
    COALESCE(SUM(CASE WHEN vote_type = 'SUPPORT' THEN 1 ELSE 0 END), 0) AS support_count,
    COALESCE(SUM(CASE WHEN vote_type = 'AGAINST' THEN 1 ELSE 0 END), 0) AS against_count,
    COUNT(*) AS total_votes
  FROM votes
  WHERE appeal_id = ?
`);

// Prepared Statements for Staff Warnings
const stmtInsertWarning = db.prepare(`
  INSERT INTO warnings (appeal_id, recipient_user_id, warning_message, staff_id, timestamp, delivery_status)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtGetWarningsByAppeal = db.prepare(`
  SELECT * FROM warnings 
  WHERE appeal_id = ? 
  ORDER BY timestamp ASC
`);

const stmtGetWarningCount = db.prepare(`
  SELECT COUNT(*) AS total 
  FROM warnings 
  WHERE appeal_id = ?
`);

/**
 * Mendapatkan permohonan aktif milik pengguna jika ada
 */
function getActiveAppealByUser(userId) {
  return stmtGetActiveByUser.get(userId) || null;
}

/**
 * Mendapatkan pengajuan terbaru user (apapun statusnya) untuk pengecekan cooldown
 */
function getLatestAppealByUser(userId) {
  return stmtGetLatestByUser.get(userId) || null;
}

function getPermanentAppealBlockByUser(userId) {
  return stmtGetPermanentBlockByUser.get(userId) || null;
}

function blockAppealUser(userId, reason, blockedBy) {
  const now = Date.now();
  const result = stmtInsertAppealUserBlock.run(userId, reason, blockedBy, now);
  return {
    success: result.changes > 0,
    block: getPermanentAppealBlockByUser(userId),
  };
}

function unblockAppealUser(userId, unblockedBy, reason) {
  const result = stmtUnblockAppealUser.run(unblockedBy, Date.now(), reason, userId);
  return result.changes > 0;
}

/**
 * Menyimpan data appeal baru dengan format nomor urut: Guild Appeal --1, Guild Appeal --2
 */
function createAppeal({
  userId,
  userTag,
  ign = '',
  robloxUsername = null,
  reason = 'Ingin bergabung dengan guild.',
  extraInfo = '-',
  robloxExperience = null,
  ageTimezone = '-',
  experience = '-',
  screenshotUrl = null,
  gearScore = null,
  rulesAgreed = 1,
  memberRating = null,
}) {
  const now = Date.now();
  const VOTE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 jam
  const voteEndsAt = now + VOTE_DURATION_MS;
  const effectiveRoblox = robloxUsername || ign || '-';
  const tempCode = `TEMP_${now}_${Math.random().toString(36).substring(2, 7)}`;

  const result = stmtInsertAppeal.run(
    tempCode,
    userId,
    userTag,
    effectiveRoblox,
    ageTimezone,
    reason,
    experience,
    screenshotUrl,
    gearScore,
    now,
    now,
    effectiveRoblox,
    rulesAgreed,
    extraInfo,
    robloxExperience,
    voteEndsAt,
    memberRating,
  );

  const appealId = Number(result.lastInsertRowid);
  const formattedCode = `Guild Appeal --${appealId}`;
  stmtUpdateCode.run(formattedCode, appealId);

  return stmtGetById.get(appealId);
}

/**
 * Menyimpan message_id dan channel_id dari embed yang dikirim ke Discord
 */
function updateAppealMessage(id, channelId, messageId) {
  const now = Date.now();
  stmtUpdateMessage.run(channelId, messageId, now, id);
  return stmtGetById.get(id);
}

function updateAppealScreenshot(id, screenshotUrl) {
  const now = Date.now();
  stmtUpdateScreenshot.run(screenshotUrl, now, id);
  return stmtGetById.get(id);
}

function deleteUnsentAppeal(id) {
  return stmtDeleteUnsentAppeal.run(id).changes > 0;
}

/**
 * Memproses keputusan review (Approve / Reject) secara atomik.
 */
function reviewAppeal(id, status, staffId, rejectionReason = null, permanentBlock = false) {
  const now = Date.now();
  const result = stmtReviewAppeal.run(status, staffId, now, rejectionReason, permanentBlock ? 1 : 0, now, id);
  const appeal = getAppealById(id);
  if (result.changes > 0 && permanentBlock && appeal) {
    stmtInsertAppealUserBlock.run(
      appeal.user_id,
      rejectionReason || 'Staff verified that actual Gear Score did not match the submitted value',
      staffId,
      now,
    );
  }

  return {
    success: result.changes > 0,
    appeal,
  };
}

/**
 * Mengambil appeal berdasarkan ID
 */
function getAppealById(id) {
  return stmtGetById.get(id) || null;
}

/**
 * Mengambil appeal berdasarkan Appeal Code
 */
function getAppealByCode(code) {
  return stmtGetByCode.get(code) || null;
}

/**
 * Mengambil appeal berdasarkan Message ID
 */
function getAppealByMessageId(messageId) {
  return stmtGetByMessageId.get(messageId) || null;
}

/**
 * Mencari riwayat appeal berdasarkan username Roblox (exact match, atau fuzzy match)
 */
function searchAppealsByRoblox(username) {
  const cleanUsername = (username || '').trim();
  if (!cleanUsername) return [];

  // 1. Coba exact match dulu (case-insensitive)
  const exactMatches = stmtSearchAppealsByRoblox.all(cleanUsername, cleanUsername);
  if (exactMatches && exactMatches.length > 0) {
    return exactMatches;
  }

  // 2. Jika tidak ada exact match, coba fuzzy search (LIKE %...%)
  return stmtSearchAppealsByRobloxFuzzy.all(`%${cleanUsername}%`, `%${cleanUsername}%`) || [];
}

/**
 * Menyimpan atau memperbarui vote dari seorang member (UPSERT atomik).
 */
function castVote(appealId, userId, voteType) {
  const existing = stmtGetUserVote.get(appealId, userId);
  const now = Date.now();

  if (existing && existing.vote_type === voteType) {
    return {
      previousVote: existing.vote_type,
      currentVote: voteType,
      changed: false,
    };
  }

  stmtUpsertVote.run(appealId, userId, voteType, now);

  return {
    previousVote: existing ? existing.vote_type : null,
    currentVote: voteType,
    changed: true,
  };
}

/**
 * Mendapatkan rekapitulasi jumlah vote untuk suatu appeal
 */
function getVoteCounts(appealId) {
  const row = stmtGetVoteCounts.get(appealId);
  return {
    support: Number(row?.support_count || 0),
    against: Number(row?.against_count || 0),
    total: Number(row?.total_votes || 0),
  };
}

/**
 * Mengambil vote pilihan seorang user jika ada
 */
function getUserVote(appealId, userId) {
  const row = stmtGetUserVote.get(appealId, userId);
  return row ? row.vote_type : null;
}

/**
 * Menyimpan riwayat warning yang diberikan staff kepada pemohon
 */
function addWarning(appealId, recipientUserId, warningMessage, staffId, deliveryStatus = 'SENT') {
  const now = Date.now();
  const result = stmtInsertWarning.run(
    appealId,
    recipientUserId,
    warningMessage,
    staffId,
    now,
    deliveryStatus,
  );
  return {
    id: Number(result.lastInsertRowid),
    appealId,
    recipientUserId,
    warningMessage,
    staffId,
    timestamp: now,
    deliveryStatus,
  };
}

/**
 * Mengambil riwayat warning pada suatu appeal
 */
function getWarningsByAppeal(appealId) {
  return stmtGetWarningsByAppeal.all(appealId);
}

/**
 * Mengambil total jumlah warning yang pernah dikirim pada suatu appeal
 */
function getWarningCount(appealId) {
  const row = stmtGetWarningCount.get(appealId);
  return Number(row?.total || 0);
}

module.exports = {
  db,
  getActiveAppealByUser,
  getLatestAppealByUser,
  getPermanentAppealBlockByUser,
  blockAppealUser,
  unblockAppealUser,
  createAppeal,
  updateAppealMessage,
  updateAppealScreenshot,
  deleteUnsentAppeal,
  reviewAppeal,
  getAppealById,
  getAppealByCode,
  getAppealByMessageId,
  searchAppealsByRoblox,
  castVote,
  getVoteCounts,
  getUserVote,
  addWarning,
  getWarningsByAppeal,
  getWarningCount,
};
