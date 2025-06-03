import mongoose from "mongoose";
const connectDB = async () => {
    try {
        if (!process.env.MONGO_URI) {
            throw new Error("MONGO_URI is not defined in environment variables");
        }
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log(`MongoDB connected: ${conn.connection.host}`);
        console.log(`lets get it : ${conn.connection.host}`);
    }
    catch (error) {
        console.error("Connection failed", error);
        process.exit(1);
    }
};
export default connectDB;
