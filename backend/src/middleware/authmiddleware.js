import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError.js';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null) || req.cookies?.accessToken;

    if (!token) {
        return res.status(401).json(new ApiError(401, 'Access token is missing'));
    }

    jwt.verify(token, process.env.JWT_Access_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json(new ApiError(403, 'Invalid or expired access token'));
        }

        req.user = user;
        next();
    });
};

export { authenticateToken };
export default authenticateToken;