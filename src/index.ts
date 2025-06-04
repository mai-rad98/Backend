// @ts-nocheck

import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import connectDB from './config/dbConnect.js'
import authRoutes from './routes/authRoutes.js'
import {app,server} from './lib/socket.js'
import cookieParser from 'cookie-parser';
import gameRoutes from './routes/gamesRoutes.js';


// Load environment variabless
dotenv.config()

const PORT = process.env.PORT || 5000

// Initialize Express app


// Middlewares
app.use(express.json())
app.use(cookieParser())
// app.use(cors({  
//     origin: "https://mmele.vercel.app",
//     credentials: true,
    
// }))

// CORS Configuration
const allowedOrigins = [
    'https://mmele.vercel.app', 
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:3000', // Add any other dev ports you might use
];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            return callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
};


  app.use(cors(corsOptions));

// Add explicit OPTIONS handling for preflight requests
 app.options('*', cors(corsOptions));

console.log("CORS configured with origins:", allowedOrigins);
console.log("4")

//routes
app.use("/api/auth",authRoutes)
app.use('/api/games', gameRoutes);



server.listen(PORT,() =>{ 
    console.log('Server is running on port '+ PORT)
    connectDB()
});