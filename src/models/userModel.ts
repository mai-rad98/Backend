import mongoose, { Document, Schema, Model } from 'mongoose';

// Define an interface for the user document
interface IUser extends Document {
    email: string;
    firstName: string;
    lastName: string;
    coolerUsername: string;
    password: string;
    profilePic?: string;
    createdAt?: Date;
    updatedAt?: Date;
}


const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    firstName: {
        type: String,
        required: true,
        trim: true,
    },
    lastName: {
        type: String,
        required: true,
        trim: true,
    },
    coolerUsername: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    password: {
        type: String,
        required: true,
    },
    profilePic: {
        type: String,
        default: null,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

userSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});



const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
export default User;
