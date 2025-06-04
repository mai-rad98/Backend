// @ts-nocheck
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/dbConnect.js';
import authRoutes from './routes/authRoutes.js';
import { app, server } from './lib/socket.js';
import cookieParser from 'cookie-parser';
import gameRoutes from './routes/gamesRoutes.js';
// Load environment variabless
dotenv.config();
const PORT = process.env.PORT || 5000;
// Initialize Express app
// Middlewares
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: "https://mmele.vercel.app",
    credentials: true,
}));
console.log("4");
//routes
app.use("/api/auth", authRoutes);
app.use('/api/games', gameRoutes);
server.listen(PORT, () => {
    console.log('Server is running on port ' + PORT);
    connectDB();
});
