// @ts-nocheck

import User from "../models/userModel.js";
import bcrypt from "bcryptjs";
import { generateTokens } from "../config/utils.js";
import { Request, Response } from "express";
import jwt from 'jsonwebtoken';

interface TokenPayload {
    userId: string;
  }


export const refreshToken = async (req: Request, res: Response): Promise<Response> => {
    try {
        const refreshToken = req.cookies.refreshToken;
        
        if (!refreshToken) {
            return res.status(401).json({ error: 'No refresh token provided' });
        }

        // Verify refresh token
        const decoded = jwt.verify(
            refreshToken, 
            process.env.JWT_REFRESH_SECRET as string
        ) as TokenPayload;

        // Generate new access token
        const newAccessToken = jwt.sign(
            { userId: decoded.userId }, 
            process.env.JWT_ACCESS_SECRET as string, 
            { expiresIn: '15m' }
        );

        return res.status(200).json({ accessToken: newAccessToken });
    } catch (error) {
        console.error('Error refreshing token:', error);
        return res.status(403).json({ error: 'Invalid refresh token' });
    }
}


export const signIn = async (req: Request, res: Response): Promise<Response> => {
    const { email, password } = req.body;
    console.log("Sign in request body:", req.body);
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "User does not exist" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid Credentials" });
        }
        console.log("1.Sign in request body:", req.body);

       //generate token
     const token = generateTokens(user._id,res)
     res.status(200).json({
         _id : user._id,
         email : user.email,
         accessToken: token

        
})
    } catch (error) {
        console.log("3Sign in request body:", req.body);

        console.error("Error in signing in", error);
        return res.status(500).json({ message: "Server Error" });
    }
};
export const signUp = async (req: Request, res: Response): Promise<Response> => {

    const { email, firstName,lastName,coolerUsername, password } = req.body;
    try {
        if (!email || !firstName || !password || !lastName || !coolerUsername) {
            return res.status(400).json({ message: "All fields are required" });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters long" });
        }

        const user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: "User already exists" });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ email, firstName,lastName,coolerUsername, password: hashedPassword });

        if(newUser){
            //generate token here
           generateToken(newUser._id,res)
            await newUser.save()

            res.status(201).json({
                _id : newUser._id,
                email : newUser.email,
                
            })
        } else {
            res.status(400).json({message : "Invalid user data"})
        }

    } catch (error) {
        console.error("Error in signing up", error);
        return res.status(500).json({ message: "Server Error" });
    }
};
export const logOut = (req: Request, res: Response): Response => {
    res.clearCookie('refreshToken', {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV !== 'development',
    });
    return res.json({ message: 'Logged out successfully' });
};


export const updateProfile = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { profilePic } = req.body;
        const userId = req.user._id;

        if (!profilePic) {
            return res.status(400).json({ message: "Profile pic is required" });
        }

        const uploadResponse = await cloudinary.uploader.upload(profilePic);
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { profilePic: uploadResponse.url },
            { new: true }
        );

        return res.status(200).json(updatedUser);
    } catch (error) {
        console.error("Error in updating profile", error);
        return res.status(500).json({ message: "Server Error" });
    }
};

export const checkAuth = (req: Request, res: Response): Response => {
    try {
        return res.status(200).json(req.user);
    } catch (error) {
        console.error("Error in checking auth", error);
        return res.status(500).json({ message: "Server Error" });
    }
};
