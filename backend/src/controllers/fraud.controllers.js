import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  getFlaggedFraudAlerts,
  resolveFraudAlert,
  getUserFraudHistory,
} from '../services/fraud.service.js';

/**
 * Get paginated list of transactions flagged for manual fraud inspection.
 * GET /api/v1/fraud/alerts
 */
export const getFlaggedAlerts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, riskLevel, reviewStatus } = req.query;

    const result = await getFlaggedFraudAlerts({
      page,
      limit,
      riskLevel: riskLevel || null,
      reviewStatus: reviewStatus || null,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, result, 'Flagged fraud alerts retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Mark a flagged transaction as reviewed by compliance / admin.
 * PATCH /api/v1/fraud/alerts/:id/review
 */
export const resolveAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resolution = 'approved', notes = '' } = req.body;
    const reviewerUserId = req.user?.id;

    if (!reviewerUserId) {
      throw new ApiError(401, 'User authentication required');
    }

    const updated = await resolveFraudAlert({
      alertId: id,
      reviewerUserId,
      resolution,
      notes,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, updated, 'Fraud alert reviewed successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user's fraud evaluation history.
 * GET /api/v1/fraud/my-history
 */
export const getMyFraudHistory = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'User authentication required');
    }

    const { page = 1, limit = 20 } = req.query;
    const history = await getUserFraudHistory({ userId, page, limit });

    return res
      .status(200)
      .json(new ApiResponse(200, history, 'User fraud history retrieved successfully'));
  } catch (error) {
    next(error);
  }
};
