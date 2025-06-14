// @ts-nocheck
import express from 'express';
import { createGameInvite, respondToGameInvite, getGameDetails, makeMove, endGame, getUserGames, getUsers,forfeitGame } from '../controllers/gamesController.js';
import { protectRoute } from '../middleware/authMiddleware.js';
const router = express.Router();
router.get("/user", protectRoute, getUsers);
router.post('/invite', protectRoute, createGameInvite);
router.post('/invite/:gameId/respond', protectRoute, respondToGameInvite);
router.get('/:gameId', protectRoute, getGameDetails);
router.post('/:gameId/move', protectRoute, makeMove);
router.post('/:gameId/leave', protectRoute, endGame);
router.post('/:gameId/forfeit', protectRoute, forfeitGame);
router.get('/', protectRoute, getUserGames);
export default router;
