// @ts-nocheck

import express from 'express';
import {
    createGameInvite,
    respondToGameInvite,
    getGameDetails,
    makeMove,
    endGame,
    getUserGames,
    getUsers
} from '../controllers/gamesController.ts';
import { protectRoute } from '../middleware/authMiddleware.ts';


const router = express.Router();

router.get("/user",protectRoute,getUsers)
router.post('/invite',protectRoute , createGameInvite);
router.post('/invite/:gameId/respond', protectRoute, respondToGameInvite);
router.get('/:gameId', protectRoute, getGameDetails);
router.post('/:gameId/move', protectRoute, makeMove);
router.post('/:gameId/leave', protectRoute, endGame);
router.get('/', protectRoute,getUserGames);

export default router;