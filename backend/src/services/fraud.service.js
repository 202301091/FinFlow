import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { createNotification } from './notification.service.js';

/**
 * Standard thresholds and risk score weights for FinFlow fraud rules.
 */
export const FRAUD_RULES = {
  VELOCITY_WINDOW_MINUTES: 10,
  VELOCITY_MAX_COUNT: 5,
  VELOCITY_POINTS: 40,

  HIGH_VALUE_THRESHOLD: 50000,
  HIGH_VALUE_POINTS: 35,

  CRITICAL_VALUE_THRESHOLD: 100000,
  CRITICAL_VALUE_POINTS: 50,

  HOURLY_VOLUME_THRESHOLD: 100000,
  HOURLY_VOLUME_POINTS: 35,

  RAPID_REPEAT_WINDOW_SECONDS: 60,
  RAPID_REPEAT_POINTS: 30,

  FLAG_THRESHOLD_SCORE: 40,
};

/**
 * Evaluate transfer risk using heuristic rules.
 * NOTE: FinFlow does not block transactions; transfers always proceed and
 * suspicious transactions are marked FLAGGED for manual compliance inspection.
 *
 * @param {Object} params
 * @param {import('pg').PoolClient} [params.client=pool] - Optional client for transaction context
 * @param {string} params.senderAccountId - Sender account UUID
 * @param {string} params.receiverAccountId - Receiver account UUID
 * @param {string} params.userId - Authenticated user UUID
 * @param {number|string} params.amount - Transfer amount
 * @param {Object} [params.rulesConfig=FRAUD_RULES] - Configurable rule thresholds
 * @returns {Promise<Object>} Risk evaluation result
 */
export const evaluateTransferRisk = async ({
  client = pool,
  senderAccountId,
  receiverAccountId,
  userId,
  amount,
  rulesConfig = FRAUD_RULES,
}) => {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new ApiError(400, 'Invalid transfer amount for risk evaluation');
  }

  const triggeredRules = [];
  let riskScore = 0;

  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - rulesConfig.VELOCITY_WINDOW_MINUTES * 60 * 1000);
  const repeatWindowAgo = new Date(
    now.getTime() - rulesConfig.RAPID_REPEAT_WINDOW_SECONDS * 1000
  );

  // Single indexed query to fetch completed transfers from sender in the last 1 hour
  const recentTxResult = await client.query(
    `SELECT amount, receiver_account_id, created_at
     FROM transactions
     WHERE sender_account_id = $1
       AND status = 'completed'
       AND created_at >= NOW() - INTERVAL '1 hour'
     ORDER BY created_at DESC`,
    [senderAccountId]
  );

  const recentTxs = recentTxResult.rows;

  // 1. Velocity Burst Check (within last 10 minutes)
  const txsIn10Min = recentTxs.filter((tx) => new Date(tx.created_at) >= tenMinutesAgo);
  if (txsIn10Min.length >= 8) {
    riskScore += 70;
    triggeredRules.push({
      code: 'EXTREME_VELOCITY_BURST',
      name: 'Extreme Transaction Velocity',
      score: 70,
      description: `${txsIn10Min.length} transfers initiated within 10 minutes`,
    });
  } else if (txsIn10Min.length >= rulesConfig.VELOCITY_MAX_COUNT) {
    riskScore += rulesConfig.VELOCITY_POINTS;
    triggeredRules.push({
      code: 'VELOCITY_BURST',
      name: 'High Transaction Velocity',
      score: rulesConfig.VELOCITY_POINTS,
      description: `${txsIn10Min.length} transfers initiated within 10 minutes`,
    });
  }

  // 2. High Single-Transaction Value Check
  if (numericAmount >= rulesConfig.CRITICAL_VALUE_THRESHOLD) {
    riskScore += rulesConfig.CRITICAL_VALUE_POINTS;
    triggeredRules.push({
      code: 'CRITICAL_HIGH_VALUE',
      name: 'Critical High-Value Transfer',
      score: rulesConfig.CRITICAL_VALUE_POINTS,
      description: `Transfer amount (₹${numericAmount.toFixed(2)}) meets or exceeds critical threshold (₹${rulesConfig.CRITICAL_VALUE_THRESHOLD})`,
    });
  } else if (numericAmount >= rulesConfig.HIGH_VALUE_THRESHOLD) {
    riskScore += rulesConfig.HIGH_VALUE_POINTS;
    triggeredRules.push({
      code: 'HIGH_VALUE_TRANSACTION',
      name: 'High-Value Transfer',
      score: rulesConfig.HIGH_VALUE_POINTS,
      description: `Transfer amount (₹${numericAmount.toFixed(2)}) meets or exceeds high threshold (₹${rulesConfig.HIGH_VALUE_THRESHOLD})`,
    });
  }

  // 3. Hourly Outflow Volume Surge Check
  const pastHourTotal = recentTxs.reduce((sum, tx) => sum + Number(tx.amount), 0);
  const projectedHourTotal = pastHourTotal + numericAmount;
  if (projectedHourTotal >= rulesConfig.HOURLY_VOLUME_THRESHOLD) {
    riskScore += rulesConfig.HOURLY_VOLUME_POINTS;
    triggeredRules.push({
      code: 'HOURLY_VOLUME_SURGE',
      name: 'Cumulative Hourly Volume Surge',
      score: rulesConfig.HOURLY_VOLUME_POINTS,
      description: `Projected 1-hour outflow (₹${projectedHourTotal.toFixed(2)}) exceeds hourly limit (₹${rulesConfig.HOURLY_VOLUME_THRESHOLD})`,
    });
  }

  // 4. Rapid Repeat Duplicate Check (within last 60 seconds)
  const rapidRepeats = recentTxs.filter(
    (tx) =>
      tx.receiver_account_id === receiverAccountId &&
      Math.abs(Number(tx.amount) - numericAmount) < 0.01 &&
      new Date(tx.created_at) >= repeatWindowAgo
  );

  if (rapidRepeats.length >= 2) {
    riskScore += 45;
    triggeredRules.push({
      code: 'RAPID_REPEAT_BURST',
      name: 'Multiple Rapid Repeat Transfers',
      score: 45,
      description: `Multiple identical transfers (₹${numericAmount.toFixed(2)}) to the same receiver within 60 seconds`,
    });
  } else if (rapidRepeats.length === 1) {
    riskScore += rulesConfig.RAPID_REPEAT_POINTS;
    triggeredRules.push({
      code: 'RAPID_REPEAT_TRANSFER',
      name: 'Rapid Repeat Transfer',
      score: rulesConfig.RAPID_REPEAT_POINTS,
      description: `Identical transfer (₹${numericAmount.toFixed(2)}) to the same receiver within 60 seconds`,
    });
  }

  // Clamp final risk score to [0, 100]
  const finalRiskScore = Math.min(100, Math.max(0, riskScore));

  let riskLevel = 'LOW';
  let decision = 'ALLOWED';

  if (finalRiskScore >= 70) {
    riskLevel = 'HIGH';
    decision = 'FLAGGED';
  } else if (finalRiskScore >= rulesConfig.FLAG_THRESHOLD_SCORE) {
    riskLevel = 'MEDIUM';
    decision = 'FLAGGED';
  }

  const requiresManualReview = decision === 'FLAGGED';

  return {
    isBlocked: false, // Never block transfers
    isFlagged: requiresManualReview,
    decision,
    riskLevel,
    riskScore: finalRiskScore,
    requiresManualReview,
    triggeredRules,
    metadata: {
      pastHourTotal,
      projectedHourTotal,
      recentTxCount10m: txsIn10Min.length,
      rapidRepeatCount: rapidRepeats.length,
      evaluatedAt: now.toISOString(),
      reviewStatus: requiresManualReview ? 'pending_review' : 'clean',
    },
  };
};

/**
 * Persist fraud evaluation outcome into PostgreSQL audit ledger.
 */
export const recordFraudEvaluation = async ({
  client = pool,
  accountId,
  userId,
  counterpartyAccountId = null,
  transactionId = null,
  amount,
  riskScore,
  riskLevel,
  decision,
  triggeredRules = [],
  metadata = {},
}) => {
  const result = await client.query(
    `INSERT INTO fraud_evaluations (
      account_id,
      user_id,
      counterparty_account_id,
      transaction_id,
      amount,
      risk_score,
      risk_level,
      decision,
      triggered_rules,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      accountId,
      userId,
      counterpartyAccountId,
      transactionId,
      amount,
      riskScore,
      riskLevel,
      decision,
      JSON.stringify(triggeredRules),
      JSON.stringify(metadata),
    ]
  );

  return result.rows[0];
};

/**
 * Post-commit evaluation handler called automatically after transferFunds completes.
 * Evaluates risk, records ledger, and notifies user/logs audit trail if flagged.
 */
export const evaluateAndRecordTransferRisk = async ({
  senderAccountId,
  receiverAccountId,
  userId,
  amount,
  transaction,
  requestId = null,
}) => {
  try {
    const evaluation = await evaluateTransferRisk({
      senderAccountId,
      receiverAccountId,
      userId,
      amount,
    });

    const record = await recordFraudEvaluation({
      accountId: senderAccountId,
      userId,
      counterpartyAccountId: receiverAccountId,
      transactionId: transaction.id,
      amount,
      riskScore: evaluation.riskScore,
      riskLevel: evaluation.riskLevel,
      decision: evaluation.decision,
      triggeredRules: evaluation.triggeredRules,
      metadata: evaluation.metadata,
    });

    // If flagged for manual inspection, notify user and log an audit trail
    if (evaluation.requiresManualReview) {
      // 1. Dispatch real-time security notice notification to user
      try {
        await createNotification({
          userId,
          type: 'SECURITY_NOTICE',
          title: 'Security Notice: High Activity Review',
          message: `Your transfer of ₹${Number(amount).toFixed(2)} was completed successfully and marked for standard compliance review due to unusual activity.`,
          metadata: {
            transactionId: transaction.id,
            riskLevel: evaluation.riskLevel,
            riskScore: evaluation.riskScore,
            triggeredRules: evaluation.triggeredRules.map((r) => r.code),
          },
        });
      } catch (notifErr) {
        console.warn('[FraudService] Failed to send security notice notification:', notifErr.message);
      }
    }

    return record;
  } catch (error) {
    console.error('[FraudService] Failed to evaluate transfer risk post-commit:', error.message);
    return null;
  }
};

/**
 * Fetch flagged alerts requiring manual inspection.
 */
export const getFlaggedFraudAlerts = async ({
  page = 1,
  limit = 20,
  riskLevel = null,
  reviewStatus = null,
} = {}) => {
  const numericPage = Math.max(1, parseInt(page, 10) || 1);
  const numericLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (numericPage - 1) * numericLimit;

  let query = `
    SELECT 
      f.id,
      f.account_id,
      f.user_id,
      f.counterparty_account_id,
      f.transaction_id,
      f.amount,
      f.risk_score,
      f.risk_level,
      f.decision,
      f.triggered_rules,
      f.metadata,
      f.created_at,
      u.name AS user_name,
      u.email AS user_email
    FROM fraud_evaluations f
    JOIN users u ON f.user_id = u.id
    WHERE f.decision = 'FLAGGED'
  `;
  const params = [];

  if (riskLevel) {
    params.push(riskLevel.toUpperCase());
    query += ` AND f.risk_level = $${params.length}`;
  }

  if (reviewStatus) {
    params.push(reviewStatus);
    query += ` AND f.metadata->>'reviewStatus' = $${params.length}`;
  }

  query += ` ORDER BY f.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(numericLimit, offset);

  const [alertsRes, countRes] = await Promise.all([
    pool.query(query, params),
    pool.query(`SELECT COUNT(*) FROM fraud_evaluations WHERE decision = 'FLAGGED'`),
  ]);

  const total = parseInt(countRes.rows[0].count, 10);

  return {
    alerts: alertsRes.rows,
    pagination: {
      currentPage: numericPage,
      totalPages: Math.ceil(total / numericLimit) || 1,
      totalItems: total,
      limit: numericLimit,
    },
  };
};

/**
 * Mark a flagged fraud alert as inspected/reviewed.
 */
export const resolveFraudAlert = async ({
  alertId,
  reviewerUserId,
  resolution, // 'approved' | 'suspicious' | 'false_positive'
  notes = '',
}) => {
  const existingRes = await pool.query('SELECT * FROM fraud_evaluations WHERE id = $1', [alertId]);
  if (existingRes.rows.length === 0) {
    throw new ApiError(404, 'Fraud alert record not found');
  }

  const alert = existingRes.rows[0];
  const updatedMetadata = {
    ...alert.metadata,
    reviewStatus: 'reviewed',
    review: {
      reviewedBy: reviewerUserId,
      reviewedAt: new Date().toISOString(),
      resolution,
      notes: notes.trim(),
    },
  };

  const updatedRes = await pool.query(
    `UPDATE fraud_evaluations
     SET metadata = $1
     WHERE id = $2
     RETURNING *`,
    [JSON.stringify(updatedMetadata), alertId]
  );

  return updatedRes.rows[0];
};

/**
 * Fetch fraud evaluation history for a specific user.
 */
export const getUserFraudHistory = async ({ userId, page = 1, limit = 20 }) => {
  const numericPage = Math.max(1, parseInt(page, 10) || 1);
  const numericLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (numericPage - 1) * numericLimit;

  const result = await pool.query(
    `SELECT * FROM fraud_evaluations
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, numericLimit, offset]
  );

  return result.rows;
};
