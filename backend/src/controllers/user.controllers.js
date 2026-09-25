import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import jwt from 'jsonwebtoken';

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

  try {
    // Check if the user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);

    if (existingUser.rows.length > 0) {
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

    return res
      .status(201)
      .json(new ApiResponse(201, newUser.rows[0], "User created successfully"));
  } catch (error) {
    console.error('Error creating user:', error);
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
      return res
        .status(404)
        .json(new ApiError(404, "Email not found"));
    }

    const user = userResult.rows[0];

    // Compare the provided password with the hashed password in the database (schema uses password_hash)
    const isPasswordValid = await bcrypt.compare(password, user.password_hash || user.password);

    if (!isPasswordValid) {
      return res
        .status(401)
        .json(new ApiError(401, "Invalid password"));
    }

    const tokens = generateToken(user);

    const loggedInUser = { ...user };
    delete loggedInUser.password;
    delete loggedInUser.password_hash;

    return res
      .status(200)
      .json(new ApiResponse(200, { user: loggedInUser, tokens }, "Login successful"));
  } catch (error) {
    console.error('Error logging in user:', error);
    return res
      .status(500)
      .json(new ApiError(500, error?.message || "Internal server error"));
  }
};

export { createUser, loginUser };
