import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { createAuditLog } from '../services/audit.service.js';
import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';

const generateToken = (user) => {
  const payload = {
    id: user.id,
    name: user.name || user.username,
    email: user.email,
  };

  const accessToken = jwt.sign(payload, process.env.JWT_Access_SECRET, { expiresIn: '1h' });
  const refreshToken = jwt.sign(payload, process.env.JWT_Refresh_SECRET, { expiresIn: '7d' });

  return { accessToken, refreshToken };
};

const createUser = async (req, res) => {
  const name = req.body.name || req.body.username;
  const { email, password } = req.body;

  if (!name || !email || !password) {
    return res
      .status(400)
      .json(new ApiError(400, "Name, email, and password are required"));
  }

  if (typeof password !== 'string' || password.length < 6) {
    return res
      .status(400)
      .json(new ApiError(400, "Password must be at least 6 characters long"));
  }

  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  if (!hasLetter || !hasNumber || !hasSymbol) {
    return res
      .status(400)
      .json(
        new ApiError(
          400,
          "Password must contain at least one letter, one number, and one symbol"
        )
      );
  }

  try {
    // Check if the user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);

    if (existingUser.rows.length > 0) {
      await createAuditLog({
        userId: null,
        action: 'USER_REGISTRATION_FAILED',
        resourceType: 'user',
        resourceId: null,
        requestId: req.id,
        status: 'FAILURE',
        metadata: { email, reason: 'User already exists with this email' },
      });

      return res
        .status(409)
        .json(new ApiError(409, "User already exists with this email"));
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new user into the database matching schema.sql columns
    const newUser = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [name, email, hashedPassword]
    );

    const createdUser = newUser.rows[0];

    // Record audit log for user registration
    await createAuditLog({
      userId: createdUser.id,
      action: 'USER_REGISTERED',
      resourceType: 'user',
      resourceId: createdUser.id,
      requestId: req.id,
      status: 'SUCCESS',
      metadata: { name: createdUser.name, email: createdUser.email },
    });

    return res
      .status(201)
      .json(new ApiResponse(201, createdUser, "User created successfully"));
  } catch (error) {
    logger.error({ err: error }, `Error creating user: ${error.message || error}`);
    return res
      .status(500)
      .json(new ApiError(500, error?.message || "Internal server error"));
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json(new ApiError(400, "Email and password are required"));
  }

  try {
    // Check if the user exists
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (userResult.rows.length === 0) {
      await createAuditLog({
        userId: null,
        action: 'USER_LOGIN_FAILED',
        resourceType: 'user',
        resourceId: null,
        requestId: req.id,
        status: 'FAILURE',
        metadata: { email, reason: 'Email not found' },
      });

      return res
        .status(404)
        .json(new ApiError(404, "Email not found"));
    }

    const user = userResult.rows[0];

    // Compare the provided password with the hashed password in the database
    const isPasswordValid = await bcrypt.compare(password, user.password_hash || user.password);

    if (!isPasswordValid) {
      await createAuditLog({
        userId: user.id,
        action: 'USER_LOGIN_FAILED',
        resourceType: 'user',
        resourceId: user.id,
        requestId: req.id,
        status: 'FAILURE',
        metadata: { email, reason: 'Invalid password' },
      });

      return res
        .status(401)
        .json(new ApiError(401, "Invalid password"));
    }

    const tokens = generateToken(user);

    const loggedInUser = { ...user };
    delete loggedInUser.password;
    delete loggedInUser.password_hash;
    loggedInUser.hasPin = Boolean(loggedInUser.transaction_pin_hash);
    delete loggedInUser.transaction_pin_hash;

    // Record audit log for successful login
    await createAuditLog({
      userId: user.id,
      action: 'USER_LOGIN_SUCCESS',
      resourceType: 'user',
      resourceId: user.id,
      requestId: req.id,
      status: 'SUCCESS',
      metadata: { email: user.email },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, { user: loggedInUser, tokens }, "Login successful"));
  } catch (error) {
    logger.error({ err: error }, `Error logging in user: ${error.message || error}`);
    return res
      .status(500)
      .json(new ApiError(500, error?.message || "Internal server error"));
  }
};

/**
 * Set or update the 6-digit transaction PIN
 * POST /api/v1/users/set-pin
 * Requires account password confirmation and 6-digit PIN
 */
const setTransactionPin = async (req, res) => {
  const userId = req.user?.id;
  const { pin, password } = req.body;

  if (!userId) {
    return res.status(401).json(new ApiError(401, 'Authentication required'));
  }

  if (!pin || typeof pin !== 'string' || !/^\d{6}$/.test(pin.trim())) {
    return res.status(400).json(new ApiError(400, 'PIN must be exactly 6 numeric digits'));
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json(new ApiError(400, 'Current account password is required to authorize PIN change'));
  }

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json(new ApiError(404, 'User not found'));
    }

    const user = userResult.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash || user.password);

    if (!isPasswordValid) {
      await createAuditLog({
        userId,
        action: 'TRANSACTION_PIN_SET_FAILED',
        resourceType: 'user',
        resourceId: userId,
        requestId: req.id,
        status: 'FAILURE',
        metadata: { reason: 'Incorrect account password' },
      });
      return res.status(401).json(new ApiError(401, 'Invalid account password'));
    }

    const hashedPin = await bcrypt.hash(pin.trim(), 10);
    await pool.query(
      'UPDATE users SET transaction_pin_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPin, userId]
    );

    await createAuditLog({
      userId,
      action: 'TRANSACTION_PIN_SET_SUCCESS',
      resourceType: 'user',
      resourceId: userId,
      requestId: req.id,
      status: 'SUCCESS',
      metadata: { pinLength: 6 },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, { hasPin: true }, '6-digit Transaction PIN configured successfully'));
  } catch (error) {
    logger.error({ err: error }, `Error setting transaction PIN: ${error.message || error}`);
    return res.status(500).json(new ApiError(500, error?.message || 'Internal server error'));
  }
};

/**
 * Check whether the user has configured a transaction PIN
 * GET /api/v1/users/pin-status
 */
const getPinStatus = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json(new ApiError(401, 'Authentication required'));
  }

  try {
    const userResult = await pool.query('SELECT transaction_pin_hash FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json(new ApiError(404, 'User not found'));
    }

    const hasPin = Boolean(userResult.rows[0].transaction_pin_hash);
    return res.status(200).json(new ApiResponse(200, { hasPin }, 'PIN status retrieved'));
  } catch (error) {
    logger.error({ err: error }, `Error checking PIN status: ${error.message || error}`);
    return res.status(500).json(new ApiError(500, error?.message || 'Internal server error'));
  }
};

export { createUser, loginUser, setTransactionPin, getPinStatus };

