import express from 'express';
import { refreshToken,signUp, signIn, logOut, updateProfile, checkAuth } from '../controllers/authController.ts';
import { protectRoute } from '../middleware/authMiddleware.ts';
const router = express.Router();

router.post("/signup", signUp);
router.post("/refresh-token", refreshToken);
router.post("/login", signIn);
router.post("/logout", logOut);
router.put("/update-profile",protectRoute, updateProfile);
router.get("/check", protectRoute, checkAuth);

export default router;
