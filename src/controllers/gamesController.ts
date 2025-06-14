// @ts-nocheck

import { Request, Response } from 'express';
import Game from '../models/gamesModel.js';
import User from '../models/userModel.js';
import { getReceiverSocketId,io } from '../lib/socket.js';

interface AuthenticatedRequest extends Request {
    user: {
        _id: string;
        username: string;
        email: string;
       
    };
}

export const getUsers = async (req: AuthenticatedRequest, res: Response<IUser[] | { message: string }>): Promise<void> => {
    try {
        const loggedInUserId = req.user._id; 
        console.log("Fetching users",loggedInUserId);
        
        // Find all users except the logged-in one, and exclude the password field
        const filteredUsers: IUser[] = await User.find({ _id: { $ne: loggedInUserId } }).select("-password");
        
        res.status(200).json(filteredUsers);
    } catch (error: unknown) {
        console.error("Error in getting users for sidebar:", error instanceof Error ? error.message : 'Unknown error');
        res.status(500).json({ message: "Server Error" });
    }
};

export const createGameInvite = async (req: Request, res: Response): Promise<Response> => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Unauthorized: User not authenticated" });
        }
        const { opponentId, gameType } = req.body;
        const initiatorId = req.user._id;

        // Validate input
        if (!opponentId || !gameType) {
            return res.status(400).json({ message: "Opponent ID and game type are required" });
        }

        // Check if opponent exists
        const opponent = await User.findById(opponentId);
        if (!opponent) {
            return res.status(404).json({ message: "Opponent not found" });
        }

        // Check if there's already a pending game between these players
        const existingGame = await Game.findOne({
            $or: [
                { initiator: initiatorId, opponent: opponentId, status: 'pending' },
                { initiator: opponentId, opponent: initiatorId, status: 'pending' }
            ]
        });

        if (existingGame) {
            return res.status(400).json({ 
                message: "There's already a pending game invite between you and this player",
                gameId: existingGame._id
            });
        }
        const initialBoard = Array(8).fill(null).map(() => Array(8).fill(null));

        // Create new game invite
        const newGame = new Game({
            initiator: initiatorId,
            opponent: opponentId,
            currentTurn:initiatorId ,
            board: initialBoard,
            moves: [],
            gameType,
            status: 'pending',
            players: {
                red: initiatorId,  
                blue: opponentId
              }
        });

        await newGame.save();

        // Populate user details for the response
        await newGame.populate('initiator opponent');

        // Notify opponent via socket if they're online
        const opponentSocketId = getReceiverSocketId(opponentId.toString());
        if (opponentSocketId) {
            io.to(opponentSocketId).emit('gameInvite', {
                gameId: newGame._id,
                initiator: newGame.initiator,
                gameType: newGame.gameType,
                inviteLink: `${process.env.FRONTEND_URL}/game/invite/${newGame._id}`
            });
        }

        return res.status(201).json({
            message: "Game invite sent successfully",
            game: newGame,
            inviteLink: `${process.env.FRONTEND_URL}/game/invite/${newGame._id}`
        });

    } catch (error) {
        console.error("Error creating game invite:", error);
        return res.status(500).json({ message: "Server Error" });
    }
};

export const getUserGames = async (req: Request, res: Response): Promise<Response> => {
    try {
        const userId = req.user._id;
        const { status } = req.query;

        let query: any = {
            $or: [
                { initiator: userId },
                { opponent: userId }
            ]
        };

        if (status) {
            query.status = status;
        }

        const games = await Game.find(query)
            .populate('initiator opponent winner', 'fullName profilePic coolerUsername')
            .sort({ updatedAt: -1 });

        // Construct invite link for each game
        const gamesWithLinks = games.map(game => ({
            ...game.toObject(),
            inviteLink: `${process.env.FRONTEND_URL}/game/invite/${game._id}`
        }));

        return res.status(200).json(gamesWithLinks);

    } catch (error) {
        console.error("Error getting user games:", error);
        return res.status(500).json({ message: "Server Error" });
    }
};

export const respondToGameInvite = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { gameId } = req.params;
        const { action } = req.body; // 'accept' or 'decline'
        const userId = req.user._id;

        // Validate action
        if (!['accept', 'decline'].includes(action)) {
            return res.status(400).json({ message: "Invalid action" });
        }

        // Find the game
        const game = await Game.findById(gameId)
            .populate('initiator opponent', 'fullName profilePic');

        if (!game) {
            return res.status(404).json({ message: "Game not found" });
        }

        // Verify the user is the opponent
        if (game.opponent._id.toString() !== userId.toString()) {
            return res.status(403).json({ message: "You are not the invited player" });
        }

        

        // Update based on action
        if (action === 'accept') {
            game.currentTurn = game.initiator; // Set first turn to initiator
            if (game.status !== 'pending') {
                return res.status(400).json({ message: 'Cannot accept non-pending game' });
              }
            game.status = 'active';
            await game.save();
            

            // Notify both players via socket
            const initiatorSocketId = getReceiverSocketId(game.initiator._id.toString());
            const opponentSocketId = getReceiverSocketId(game.opponent._id.toString());

            if (initiatorSocketId) {
                io.to(initiatorSocketId).emit('gameAccepted', {
                    gameId: game._id,
                    opponent: game.opponent,       
                    gameType: game.gameType,

                });
            }

            if (opponentSocketId) {
                io.to(opponentSocketId).emit('gameStarted', {
                    gameId: game._id,
                    initiator: game.initiator
                });
            }

            return res.status(200).json({
                message: "Game accepted",
                game
            });

        } else { // decline
            game.status = 'declined';
            await game.save();

            // Notify initiator via socket
            const initiatorSocketId = getReceiverSocketId(game.initiator._id.toString());
            if (initiatorSocketId) {
                io.to(initiatorSocketId).emit('gameDeclined', {
                    gameId: game._id,
                    opponent: game.opponent
                });
            }

            return res.status(200).json({
                message: "Game declined",
                game
            });
        }

    } catch (error) {
        console.error("Error responding to game invite:", error);
        return res.status(500).json({ message: "Server Error" });
    }
};

export const getGameDetails = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { gameId } = req.params;
        const userId = req.user._id;
        

        const game = await Game.findById(gameId)
            .populate('initiator opponent winner', 'fullName profilePic coolerUsername');

        if (!game) {
            return res.status(404).json({ message: "Game not found" });
        }

        // Verify the user is part of this game
        if (game.initiator._id.toString() !== userId.toString() && 
            game.opponent._id.toString() !== userId.toString()) {
            return res.status(403).json({ message: "You are not part of this game" });
        }

        return res.status(200).json(game);

    } catch (error) {
        console.error("Error getting game details:", error);
        return res.status(500).json({ message: "Server Error" });
    }
};

// Helper to parse and apply moves like "A1-B1"
const applyMoveToBoard = (board: string[][], move: any, playerColor: string) => {
    const { x, y } = move.position;

    if (!board || !Array.isArray(board) || !Array.isArray(board[0])) {
        throw new Error("Invalid board structure");
    }

    if (x < 0 || y < 0 || y >= board.length || x >= board[0].length) {
        throw new Error("Move out of bounds");
    }

    if (!board[y] || typeof x !== 'number' || typeof y !== 'number') {
        throw new Error(`Invalid board access at x=${x}, y=${y}`);
    }

    if (board[y][x] !== null && board[y][x] !== '') {
        throw new Error("Cell already occupied");
    }

    board[y][x] = playerColor;
    return { valid: true, newBoard: board };
};


export const makeMove = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { gameId } = req.params;
        const { move } = req.body;
        const userId = req.user?._id;
        

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized: user ID missing" });
        }

        if (!move) {
            return res.status(400).json({ message: "Move is required" });
        }

        const game = await Game.findById(gameId);
        if (!game) {
            return res.status(404).json({ message: "Game not found" });
        }
        

        // Validate that it's the player's turn
        if (game.currentTurn.toString() !== userId.toString()) {
            return res.status(400).json({ message: "It's not your turn!" });
        }

        // Check if the game is active
        if (game.status !== 'active') {
            return res.status(400).json({ 
                message: `Game is ${game.status}`,
                currentStatus: game.status
            });
        }

        // Determine player color based on who's making the move
        const playerColor = game.players.red.toString() === userId.toString() ? 'red' : 'blue';

        // Apply the move
        let newBoard;
        console.log('Board before move:', JSON.stringify(game.board));

        try {
            const result = applyMoveToBoard(game.board, move, playerColor);
            newBoard = result.newBoard;
        } catch (err) {
            return res.status(400).json({ message: err.message });
        }

        // Update the game state
        game.board = newBoard;
        // Change turn: alternate between red and blue
        game.currentTurn = game.players.red.toString() === game.currentTurn.toString()
            ? game.players.blue
            : game.players.red;

        game.moves.push({
            player: userId,
            move: JSON.stringify(move),
            timestamp: new Date(),
        });

        // Save the updated game state
        await game.save();
        

        // Notify opponent about the move
        try {
            const opponentId = game.currentTurn.toString();
            const opponentSocketId = getReceiverSocketId(opponentId);
            if (opponentSocketId) {
                io.to(opponentSocketId).emit('moveMade', {
                    gameId: game._id,
                    move,
                    player: userId,
                    board: newBoard,
                    nextTurn: game.currentTurn,
                    timestamp: new Date(),
                });
            }
            console.log('Move received:', {
                move,
                userId,
                currentTurn: game.currentTurn,
                initiator: game.initiator,
                opponent: game.opponent
              });
        } catch (notifyErr) {
            console.warn("[Move] Socket notification failed:", notifyErr);
        }

        return res.status(200).json({
            message: "Move recorded",
            game,
        });

    } catch (error) {
        console.error('[GameStore] Move error:', error);
        const errorMessage = error.response?.data?.message || 
          (error.response?.data?.error || 
          error.message || 
          "Failed to make move");
        set({ moveError: errorMessage });
        toast.error(`Move failed: ${errorMessage}`);
        throw error;
    }
};

export const endGame = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { gameId } = req.params;
        const { winnerId } = req.body; // optional - if not provided, it's a draw
        const userId = req.user._id;

        const game = await Game.findById(gameId);

        if (!game) {
            return res.status(404).json({ message: "Game not found" });
        }

        // Verify the user is part of this game
        if (game.initiator._id.toString() !== userId.toString() && 
            game.opponent._id.toString() !== userId.toString()) {
            return res.status(403).json({ message: "You are not part of this game" });
        }

        // Check game is active
        if (game.status !== 'active') {
            return res.status(400).json({ message: "Game is not active" });
        }

        // Update game status
        game.status = 'completed';
        if (winnerId) {
            game.winner = winnerId;
        }

        await game.save();

        // Notify both players
        const initiatorSocketId = getReceiverSocketId(game.initiator._id.toString());
        const opponentSocketId = getReceiverSocketId(game.opponent._id.toString());

        const gameEndData = {
            gameId: game._id,
            winner: winnerId || null
        };

        if (initiatorSocketId) {
            io.to(initiatorSocketId).emit('gameEnded', gameEndData);
        }

        if (opponentSocketId) {
            io.to(opponentSocketId).emit('gameEnded', gameEndData);
        }

        return res.status(200).json({
            message: "Game ended",
            game
        });

    } catch (error) {
        console.error("Error ending game:", error);
        return res.status(500).json({ message: "Server Error" });
    }
};


// Add this method to your games controller

export const forfeitGame = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { gameId } = req.params;
      const userId = req.user.id;
      
      // Find the game and populate players if needed
      const game = await Game.findById(gameId).populate('players.userId', 'username');
      
      if (!game) {
        return res.status(404).json({ 
          success: false, 
          message: "Game not found" 
        });
      }
      
      // Debug log to check the structure
      console.log('Game players structure:', game.players);
      console.log('Type of game.players:', typeof game.players);
      console.log('Is array:', Array.isArray(game.players));
      
      // Ensure players is an array
      if (!Array.isArray(game.players)) {
        console.error('game.players is not an array:', game.players);
        return res.status(500).json({ 
          success: false, 
          message: "Invalid game data structure" 
        });
      }
      
      // Check if user is a participant in this game
      const isPlayer = game.players.some(player => {
        // Handle different possible structures
        const playerId = player.userId || player._id || player;
        return playerId.toString() === userId.toString();
      });
      
      if (!isPlayer) {
        return res.status(403).json({ 
          success: false, 
          message: "You are not a participant in this game" 
        });
      }
      
      // Check if game is already finished
      if (game.status === 'completed' || game.status === 'forfeited') {
        return res.status(400).json({ 
          success: false, 
          message: "Game is already finished" 
        });
      }
      
      // Determine the forfeiting player and winner
      const forfeitingPlayer = game.players.find(player => {
        const playerId = player.userId || player._id || player;
        return playerId.toString() === userId.toString();
      });
      
      const winningPlayer = game.players.find(player => {
        const playerId = player.userId || player._id || player;
        return playerId.toString() !== userId.toString();
      });
      
      // Update game status
      game.status = 'forfeited';
      game.winner = winningPlayer ? (winningPlayer.userId || winningPlayer._id || winningPlayer) : null;
      game.forfeitedBy = userId;
      game.endedAt = new Date();
      game.endReason = 'forfeit';
      
      // Save the updated game
      await game.save();
      
      // Update player statistics (optional)
      if (winningPlayer) {
        const winnerId = winningPlayer.userId || winningPlayer._id || winningPlayer;
        await updatePlayerStats(winnerId, 'win');
      }
      await updatePlayerStats(userId, 'loss');
      
      // Note: Socket event emission should be handled in your socket.ts file
      // You can either:
      // 1. Emit an internal event that your socket handler listens to
      // 2. Call a socket service function from here
      // 3. Handle the forfeit logic directly in your socket handler
      
      return res.status(200).json({
        success: true,
        message: "Game forfeited successfully",
        data: {
          gameId: game._id,
          status: game.status,
          winner: game.winner,
          forfeitedBy: game.forfeitedBy,
          endedAt: game.endedAt
        }
      });
      
    } catch (error) {
      console.error('Error forfeiting game:', error);
      return res.status(500).json({ 
        success: false, 
        message: "Internal server error" 
      });
    }
  };
  
