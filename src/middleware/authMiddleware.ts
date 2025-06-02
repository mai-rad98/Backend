import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import User from '../models/userModel.js';

interface AuthRequest extends Request {
    user?: any;
}

interface TokenPayload {
    userId: string;
}

export const protectRoute = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        // 1. Get token from Authorization header (Bearer token)
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; 
        
        if (!token) {
            return res.status(401).json({ 
                message: "Unauthorized: No access token provided",
                shouldRefresh: true 
            });
        }

        // 2. Verify access token
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET as string) as TokenPayload;

        const user = await User.findById(decoded.userId).select("-password");
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // 4. Attach user to request
        req.user = user;
        next();
        console.log("Authorization header:", req.headers['authorization']);

    } catch (error: any) {
        console.log("Error in protectRoute: ", error.message);
        
        // Handle different error cases specifically
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ 
                message: "Access token expired",
                shouldRefresh: true 
            });
        }
        
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ 
                message: "Invalid token",
                shouldLogout: true
            });
        }

        res.status(500).json({ message: "Server error" });
    }
};