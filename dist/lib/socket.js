// @ts-nocheck
import { Server } from 'socket.io';
import http from 'http';
import express from 'express';
import Game from '../models/gamesModel.js';
const app = express();
const server = http.createServer(app);
const userSocketMap = {};
const io = new Server(server, {
    cors: {
        origin: "*",
        credentials: true,
        methods: ["GET", "POST"]
    },
    path: "/socket.io",
});
export function getReceiverSocketId(userId) {
    return userSocketMap[userId];
}
// Define the getPlayerById function above the socket.on handlers
function getPlayerById(players, playerId) {
    // Convert IDs to strings for comparison
    const playerId_str = playerId.toString();
    // Check if the player is red (initiator)
    if (players.red && players.red.toString() === playerId_str) {
        return { color: 'red', userId: players.red };
    }
    // Check if the player is blue (opponent)
    if (players.blue && players.blue.toString() === playerId_str) {
        return { color: 'blue', userId: players.blue };
    }
    return null;
}
// Winner check function that can be reused in multiple handlers
function checkForWinner(game) {
    // Only check for winner in moving phase
    if (game.phase !== 'moving') {
        return null;
    }
    // Count pieces for each player
    const redPieces = game.board.pieces.filter(p => p.player === 'red').length;
    const bluePieces = game.board.pieces.filter(p => p.player === 'blue').length;
    console.log(`🏆 Checking winner - Red pieces: ${redPieces}, Blue pieces: ${bluePieces}`);
    // If any player has fewer than 3 pieces, they lose
    if (redPieces < 3) {
        return {
            winner: game.players.blue,
            reason: "Red has fewer than 3 pieces remaining"
        };
    }
    if (bluePieces < 3) {
        return {
            winner: game.players.red,
            reason: "Blue has fewer than 3 pieces remaining"
        };
    }
    return null; // No winner yet
}


const isPartOfMill = (position, player, pieces) => {
  const mills = [
    // Outer square horizontal & vertical
    [{x: 0, y: 0}, {x: 3, y: 0}, {x: 6, y: 0}],
    [{x: 0, y: 0}, {x: 0, y: 3}, {x: 0, y: 6}],
    [{x: 0, y: 6}, {x: 3, y: 6}, {x: 6, y: 6}],
    [{x: 6, y: 0}, {x: 6, y: 3}, {x: 6, y: 6}],

    // Middle square horizontal & vertical
    [{x: 1, y: 1}, {x: 3, y: 1}, {x: 5, y: 1}],
    [{x: 1, y: 5}, {x: 3, y: 5}, {x: 5, y: 5}],
    [{x: 1, y: 1}, {x: 1, y: 3}, {x: 1, y: 5}],
    [{x: 5, y: 1}, {x: 5, y: 3}, {x: 5, y: 5}],

    // Inner square horizontal & vertical
    [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}],
    [{x: 2, y: 4}, {x: 3, y: 4}, {x: 4, y: 4}],
    [{x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}],
    [{x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}],

    // Cross-square vertical
    [{x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}],
    [{x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6}],
    [{x: 0, y: 3}, {x: 1, y: 3}, {x: 2, y: 3}],
    [{x: 4, y: 3}, {x: 5, y: 3}, {x: 6, y: 3}],

    // Diagonal mills
    [{x: 0, y: 0}, {x: 1, y: 1}, {x: 2, y: 2}],
    [{x: 6, y: 0}, {x: 5, y: 1}, {x: 4, y: 2}],
    [{x: 6, y: 6}, {x: 5, y: 5}, {x: 4, y: 4}],
    [{x: 0, y: 6}, {x: 1, y: 5}, {x: 2, y: 4}],
  ];

  return mills.some(line =>
    line.every(pos =>
      pieces.some(p =>
        p.player === player &&
        p.position.x === pos.x &&
        p.position.y === pos.y
      )
    ) &&
    line.some(pos =>
      pos.x === position.x && pos.y === position.y
    )
  );
};

io.on("connection", (socket) => {
    console.log("A user connected", socket.id);
    console.log(`New connection: ${socket.id}`);
    socket.onAny((event, ...args) => {
        console.log(`Incoming event: ${event}`, args);
    });
    // Wait for expliit registration event rather than using query params directly
    socket.on("register-user", (userId) => {
        if (userId) {
            userSocketMap[userId] = socket.id;
            console.log(`User ${userId} registered with socket ${socket.id}`);
            // Broadcast updated online users list to all clients
            io.emit("getOnlineUsers", Object.keys(userSocketMap));
            // Join a user-specific room
            socket.join(`user_${userId}`);
        }
    });
    socket.on("disconnect", () => {
        console.log("A user disconnected", socket.id);
        // Find and remove the user associated with this socket
        const userId = Object.keys(userSocketMap).find((key) => userSocketMap[key] === socket.id);
        if (userId) {
            console.log(`User ${userId} disconnected`);
            delete userSocketMap[userId];
            // Broadcast updated online users list
            io.emit("getOnlineUsers", Object.keys(userSocketMap));
        }
    });
    // Listen for playerReady event
    socket.on("playerReady", async ({ gameId, playerId }, callback) => {
        console.log("Incoming event: playerReady", { gameId, playerId });
        // Validate input
        if (!gameId || !playerId) {
            console.log("Missing gameId or playerId");
            return callback?.({ success: false, error: "Missing gameId or playerId" });
        }
        try {
            console.log("📡 Fetching game with ID:", gameId);
            const game = await Game.findById(gameId);
            if (!game) {
                console.log("❌ Game not found for ID:", gameId);
                return callback?.({ success: false, error: "Game not found" });
            }
            const { red, blue } = game.players;
            // Determine which color the player is
            let color = null;
            if (red.toString() === playerId)
                color = 'red';
            else if (blue.toString() === playerId)
                color = 'blue';
            if (!color) {
                console.log("❌ Player not found in game");
                return callback?.({ success: false, error: "Player not found in game" });
            }
            console.log(`✅ Player is in game as ${color}, updating readiness...`);
            // Update the ready status of the player
            await Game.updateOne({ _id: gameId }, { $set: { [`readyPlayers.${color}`]: true } });
            // Respond to the client immediately
            callback?.({ success: true });
            // Join the game room
            socket.join(`game_${gameId}`);
            // Notify other players
            io.to(`game_${gameId}`).emit("playerReadyUpdate", { playerId });
            // Check if both players are ready
            const updatedGame = await Game.findById(gameId).lean();
            const allReady = updatedGame?.readyPlayers.red && updatedGame?.readyPlayers.blue;
            if (allReady) {
                io.to(`game_${gameId}`).emit("gameStart");
                console.log("✅ Game started, all players are ready");
            }
        }
        catch (error) {
            console.error("❌ Error in playerReady:", error);
            callback?.({
                success: false,
                error: error.message || "Internal server error"
            });
        }
    });
    //join game event
    socket.on("joinGame", async ({ gameId, playerId }, callback) => {
        try {
            const game = await Game.findById(gameId);
            if (!game) {
                console.error("Game not found:", gameId);
                return callback({ success: false, error: "Game not found" });
            }
            // Optional: Check if player is part of the game
            const isPlayerInGame = [game.initiator.toString(), game.opponent?.toString()].includes(playerId);
            if (!isPlayerInGame) {
                return callback({ success: false, error: "You're not a player in this game" });
            }
            socket.join(gameId);
            console.log(`Player ${playerId} joined game ${gameId}`);
            return callback({ success: true });
        }
        catch (error) {
            console.error("Join game error:", error);
            return callback({ success: false, error: "Server error while joining game" });
        }
    });
    // Listen for placePiece event
    socket.on('placePiece', async ({ gameId, piece, playerId, formedMill }, acknowledge) => {
        try {
            console.log('Received placePiece:', { gameId, piece, playerId, formedMill });
            const game = await Game.findById(gameId);
            if (!game) {
                return acknowledge({ success: false, error: 'Game not found' });
            }
            const player = getPlayerById(game.players, playerId);
            if (!player) {
                return acknowledge({ success: false, error: 'Player not found in this game' });
            }
            if (game.currentTurn.toString() !== playerId.toString()) {
                console.log("⚠️ Place denied - Not your turn");
                return acknowledge({ success: false, error: "It's not your turn" });
            }
            // Build update object
            const update = {
                $push: { "board.pieces": {
                        id: piece.id,
                        player: piece.player,
                        position: { x: Number(piece.position.x), y: Number(piece.position.y) }
                    } },
                $inc: { [`placedPieces${piece.player[0].toUpperCase() + piece.player.slice(1)}`]: 1 },
                $set: {}
            };
            // Determine next turn & phase
            if (!formedMill) {
                update.$set.currentTurn = (piece.player === 'red') ? game.players.blue : game.players.red;
                const newPlacedRed = piece.player === 'red' ? game.placedPiecesRed + 1 : game.placedPiecesRed;
                const newPlacedBlue = piece.player === 'blue' ? game.placedPiecesBlue + 1 : game.placedPiecesBlue;
                update.$set.phase = (newPlacedRed >= 12 && newPlacedBlue >= 12) ? 'moving' : 'placing';
            }
            else {
                update.$set.phase = 'removing';
                update.$set.currentTurn = playerId;
            }
            console.log('🟢 Attempting atomic insert at position:', piece.position);
            // Perform atomic update (check + insert in one op)
            const updateResult = await Game.updateOne({ _id: gameId, "board.pieces.position": { $ne: { x: piece.position.x, y: piece.position.y } } }, update);
            if (updateResult.nModified === 0) {
                console.log(`⚠️ Position (${piece.position.x}, ${piece.position.y}) already occupied (atomic check)`);
                return acknowledge({ success: false, error: "Position already occupied" });
            }
            // Fetch updated game to emit updated board
            const updatedGame = await Game.findById(gameId);
            if (!updatedGame) {
                console.log(`⚠️ Position (${piece.position.x}, ${piece.position.y}) already occupied (atomic check)`);
                return acknowledge({ success: false, error: "Position already occupied" });
            }
            console.log('✅ Updated counts:', updatedGame.placedPiecesRed, updatedGame.placedPiecesBlue);
            acknowledge({
                success: true,
                placedPiecesRed: updatedGame.placedPiecesRed || 0,
                placedPiecesBlue: updatedGame.placedPiecesBlue || 0
            });
            console.log('After save - board pieces:', updatedGame.board.pieces.length);
            console.log('After save - currentTurn:', updatedGame.currentTurn, 'phase:', updatedGame.phase);
            console.log('END placePiece handler');
            const responseData = {
                updatedPieces: updatedGame.board.pieces,
                piece,
                player: piece.player,
                formedMill,
                currentTurn: update.$set.currentTurn,
                phase: update.$set.phase,
                placedPiecesRed: updatedGame.placedPiecesRed || 0,
                placedPiecesBlue: updatedGame.placedPiecesBlue || 0
            };
            io.to(gameId).emit('piecePlaced', responseData);
            console.log('🔊 Emitted piecePlaced:', responseData);
            // acknowledge({ success: true ,
            //   placedPiecesRed: game.placedPiecesRed || 0,
            //   placedPiecesBlue: game.placedPiecesBlue || 0});
        }
        catch (error) {
            console.error('Place piece error:', error);
            acknowledge({ success: false, error: error.message });
        }
    });
   /*  socket.on("removePiece", async ({ gameId, position, playerId }, callback) => {
        try {
            console.log("📥 Received removePiece:", { gameId, position, playerId });
            const game = await Game.findById(gameId);
            if (!game || !game.board?.pieces) {
                console.error("❌ Game or board not initialized");
                return callback({ success: false, error: "Game not found or invalid board" });
            }
            const pieceIndex = game.board.pieces.findIndex(p => Number(p.position?.x) === Number(position.x) &&
                Number(p.position?.y) === Number(position.y));
            if (pieceIndex === -1) {
                console.error("❌ Piece not found");
                return callback({ success: false, error: "Piece not found" });
            }
            const removed = game.board.pieces.splice(pieceIndex, 1);
            console.log("🗑️ Removed piece:", removed);
            console.log("📌 Before save - board pieces count:", game.board.pieces.length);
            game.markModified('board');
            //game.phase = 'placing';
            const bothPlacedAll = game.placedPiecesRed >= 12 && game.placedPiecesBlue >= 12;
            if (bothPlacedAll) {
                game.phase = 'moving';
            }
            else {
                game.phase = 'placing';
            }
            game.currentTurn = game.players.red.equals(playerId)
                ? game.players.blue
                : game.players.red;
            // ✅ NEW: Check for winner after removing a piece
            const winnerResult = checkForWinner(game);
            if (winnerResult) {
                game.winner = winnerResult.winner;
                console.log(`🏆 Winner detected: ${game.winner}`);
            }
            await game.save();
            console.log("💾 Game saved successfully");
            const fresh = await Game.findById(gameId);
            console.log("🧪 Reloaded from DB - board pieces:", fresh.board.pieces.length);
            io.to(gameId).emit('pieceRemoved', {
                removedPosition: position,
                updatedPieces: fresh.board.pieces,
                nextPlayer: fresh.currentTurn,
                phase: fresh.phase,
                winner: fresh.winner
            });
            // If there's a winner, also emit a specific gameOver event
            if (fresh.winner) {
                io.to(gameId).emit('gameOver', {
                    winner: fresh.winner,
                    reason: winnerResult.reason
                });
            }
            callback({ success: true });
        }
        catch (error) {
            console.error("🔥 Save failed:", error);
            callback({ success: false, error: error.message });
        }
    }); */
    
    socket.on("removePiece", async ({ gameId, position, playerId }, callback) => {
      try {
        console.log("📥 Received removePiece:", { gameId, position, playerId });
    
        const game = await Game.findById(gameId);
        if (!game || !game.board?.pieces) {
          console.error("❌ Game or board not initialized");
          return callback({ success: false, error: "Game not found or invalid board" });
        }
    
        // Identify player color
        const playerColor = game.players.red.equals(playerId) ? "red" : "blue";
        const opponentColor = playerColor === "red" ? "blue" : "red";
    
        // Validate mill lock before removal
        const opponentPieces = game.board.pieces.filter(p => p.player === opponentColor);
        const nonMillPieces = opponentPieces.filter(p => !isPartOfMill(p.position, opponentColor, game.board.pieces));
    
        const isTryingToRemoveFromMill = isPartOfMill(position, opponentColor, game.board.pieces);
        if (nonMillPieces.length > 0 && isTryingToRemoveFromMill) {
          console.warn("❌ Attempted to remove a piece in a mill while others are available");
          return callback({ success: false, error: "You can’t remove a piece in a mill unless no other pieces are available." });
        }
    
        // Locate piece to remove
        const pieceIndex = game.board.pieces.findIndex(p =>
          Number(p.position?.x) === Number(position.x) &&
          Number(p.position?.y) === Number(position.y)
        );
    
        if (pieceIndex === -1) {
          console.error("❌ Piece not found");
          return callback({ success: false, error: "Piece not found" });
        }
    
        // Remove the piece
        const removed = game.board.pieces.splice(pieceIndex, 1);
        console.log("🗑️ Removed piece:", removed);
        console.log("📌 Before save - board pieces count:", game.board.pieces.length);
    
        game.markModified('board');
    
        // Decide game phase
        const bothPlacedAll = game.placedPiecesRed >= 12 && game.placedPiecesBlue >= 12;
        game.phase = bothPlacedAll ? 'moving' : 'placing';
    
        // Switch turn
        game.currentTurn = game.players.red.equals(playerId)
          ? game.players.blue
          : game.players.red;
    
        // Check for winner
        const winnerResult = checkForWinner(game);
        if (winnerResult) {
          game.winner = winnerResult.winner;
          console.log(`🏆 Winner detected: ${game.winner}`);
        }
    
        await game.save();
        console.log("💾 Game saved successfully");
    
        const fresh = await Game.findById(gameId);
        console.log("🧪 Reloaded from DB - board pieces:", fresh.board.pieces.length);
    
        // Emit updates
        io.to(gameId).emit('pieceRemoved', {
          removedPosition: position,
          updatedPieces: fresh.board.pieces,
          nextPlayer: fresh.currentTurn,
          phase: fresh.phase,
          winner: fresh.winner
        });
    
        if (fresh.winner) {
          io.to(gameId).emit('gameOver', {
            winner: fresh.winner,
            reason: winnerResult.reason
          });
        }
    
        callback({ success: true });
    
      } catch (error) {
        console.error("🔥 Save failed:", error);
        callback({ success: false, error: error.message });
      }
    });
    
    /*  socket.on('movePiece', async ({ gameId, pieceId, newPosition, playerId }, acknowledge) => {
      console.log('🟢 Received movePiece request:', { gameId, pieceId, newPosition, playerId });
    
      function checkForMill(position, player, pieces) {
        const mills = [
          // Horizontal lines
          [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }],
          [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 1 }],
          [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }],
          [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }],
          [{ x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }],
          [{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }],
          [{ x: 1, y: 5 }, { x: 3, y: 5 }, { x: 5, y: 5 }],
          [{ x: 0, y: 6 }, { x: 3, y: 6 }, { x: 6, y: 6 }],
          // Vertical lines
          [{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 0, y: 6 }],
          [{ x: 1, y: 1 }, { x: 1, y: 3 }, { x: 1, y: 5 }],
          [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }],
          [{ x: 3, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }],
          [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }],
          [{ x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }],
          [{ x: 5, y: 1 }, { x: 5, y: 3 }, { x: 5, y: 5 }],
          [{ x: 6, y: 0 }, { x: 6, y: 3 }, { x: 6, y: 6 }],
          
    
    
          //diagonal lines
          [{ x: 0, y: 0 }, { x: 3, y: 3 }, { x: 6, y: 6 }],
          [{ x: 0, y: 6 }, { x: 3, y: 3 }, { x: 6, y: 0 }],
        ];
      
        return mills.some(line =>
          line.every(pos =>
            pieces.some(p =>
              p.player === player &&
              p.position.x === pos.x &&
              p.position.y === pos.y
            )
          ) &&
          line.some(pos => pos.x === position.x && pos.y === position.y) // must include the moved position
        );
      }
    
      const game = await Game.findById(gameId);
      if (!game) {
        console.log('❌ Game not found:', gameId);
        return acknowledge({ success: false, error: "Game not found" });
      }
    
      const currentPlayerColor = game.players.red.equals(game.currentTurn) ? 'red' : 'blue';
    
      const piece = game.board.pieces.find(p => p.id === pieceId && p.player === currentPlayerColor);
      if (!piece) {
        console.log('❌ Invalid piece move');
        return acknowledge({ success: false, error: "Invalid piece" });
      }
    
      function canMoveTo(pos1, pos2, boardPieces, gamePhase, playerPiecesCount) {
        // Log the values for debugging
        const dx = Math.abs(pos1.x - pos2.x);
        const dy = Math.abs(pos1.y - pos2.y);
        console.log(`🔍 Checking move from (${pos1.x},${pos1.y}) to (${pos2.x},${pos2.y})`);
        console.log(`🔍 dx: ${dx}, dy: ${dy}`);
        
        // Check if destination is occupied
        const isEmpty = !boardPieces.some(p =>
          p.position.x === pos2.x && p.position.y === pos2.y
        );
        
        if (!isEmpty) {
          console.log('❌ Position is occupied');
          return false;
        }
        
        // In 12 Men's Morris, players can "fly" (move to any empty position) when they have 3 pieces left
        if (gamePhase === 'flying' || playerPiecesCount <= 3) {
          console.log('🟢 Flying is allowed - can move anywhere');
          return true;
        }
        
        // Check if positions are adjacent on the board
        // For 12 Men's Morris, we need to define valid connections
        const isValidConnection = isAdjacentOnBoard(pos1, pos2);
        console.log(`🟢 Is valid connection: ${isValidConnection}`);
        return isValidConnection;
      }
      
      function isAdjacentOnBoard(pos1, pos2) {
        // Define all valid connections on a 12 Men's Morris board
        const connections = [
          // Outer square
          [{x: 0, y: 0}, {x: 3, y: 0}], [{x: 3, y: 0}, {x: 6, y: 0}],
          [{x: 0, y: 0}, {x: 0, y: 3}], [{x: 6, y: 0}, {x: 6, y: 3}],
          [{x: 0, y: 6}, {x: 3, y: 6}], [{x: 3, y: 6}, {x: 6, y: 6}],
          [{x: 0, y: 3}, {x: 0, y: 6}], [{x: 6, y: 3}, {x: 6, y: 6}],
          
          // Middle square
          [{x: 1, y: 1}, {x: 3, y: 1}], [{x: 3, y: 1}, {x: 5, y: 1}],
          [{x: 1, y: 1}, {x: 1, y: 3}], [{x: 5, y: 1}, {x: 5, y: 3}],
          [{x: 1, y: 5}, {x: 3, y: 5}], [{x: 3, y: 5}, {x: 5, y: 5}],
          [{x: 1, y: 3}, {x: 1, y: 5}], [{x: 5, y: 3}, {x: 5, y: 5}],
          
          // Inner square
          [{x: 2, y: 2}, {x: 3, y: 2}], [{x: 3, y: 2}, {x: 4, y: 2}],
          [{x: 2, y: 2}, {x: 2, y: 3}], [{x: 4, y: 2}, {x: 4, y: 3}],
          [{x: 2, y: 4}, {x: 3, y: 4}], [{x: 3, y: 4}, {x: 4, y: 4}],
          [{x: 2, y: 3}, {x: 2, y: 4}], [{x: 4, y: 3}, {x: 4, y: 4}],
          
          // Connecting lines
          [{x: 0, y: 3}, {x: 1, y: 3}], [{x: 1, y: 3}, {x: 2, y: 3}],
          [{x: 4, y: 3}, {x: 5, y: 3}], [{x: 5, y: 3}, {x: 6, y: 3}],
          [{x: 3, y: 0}, {x: 3, y: 1}], [{x: 3, y: 1}, {x: 3, y: 2}],
          [{x: 3, y: 4}, {x: 3, y: 5}], [{x: 3, y: 5}, {x: 3, y: 6}]
        ];
        
        // Check if the move is along one of the valid connections
        for (const [p1, p2] of connections) {
          if ((p1.x === pos1.x && p1.y === pos1.y && p2.x === pos2.x && p2.y === pos2.y) ||
              (p2.x === pos1.x && p2.y === pos1.y && p1.x === pos2.x && p1.y === pos2.y)) {
            return true;
          }
        }
        
        return false;
      }
    
      // Count the player's remaining pieces
      const playerPiecesCount = game.board.pieces.filter(p => p.player === currentPlayerColor).length;
    
      // Check if the move is valid
      const isValidMove = canMoveTo(
        piece.position,          // Current position
        newPosition,             // Target position
        game.board.pieces,       // All pieces on board
        game.phase,              // Game phase
        playerPiecesCount        // Player's piece count
      );
    
      if (!isValidMove) {
        console.log('❌ Invalid move');
        return acknowledge({ success: false, error: "Invalid move" });
      }
    
      // ✅ Update position
      piece.position = newPosition;
      console.log(`🟢 Moved piece ${pieceId} to:`, newPosition);
    
      // ✅ Check for mill
      const formedMill = checkForMill(newPosition, currentPlayerColor, game.board.pieces);
      console.log('🟢 Mill formed:', formedMill);
    
      if (formedMill) {
        game.phase = 'removing'; // set phase to removing
        game.currentTurn = game.currentTurn; // keep same player
        console.log('🟢 Mill formed! Entering removing phase');
      } else {
        game.phase = 'moving';
        game.currentTurn = game.players.red.equals(game.currentTurn) ? game.players.blue : game.players.red;
        console.log('🟢 No mill. Switching turn to:', game.currentTurn);
      }
    // ✅ NEW: Check for winner after a move (only when no mill is formed)
    const winnerResult = checkForWinner(game);
    if (winnerResult) {
      game.winner = winnerResult.winner;
      console.log(`🏆 Winner detected: ${game.winner}`);
    }
      
      await game.save();
      io.to(gameId).emit('pieceMoved', {
        updatedPieces: game.board.pieces,
        currentTurn: game.currentTurn,
        formedMill,
        phase: game.phase,
        winner: game.winner // Include winner info if set
    
      });
    
      // If there's a winner, also emit a specific gameOver event
      if (game.winner) {
        io.to(gameId).emit('gameOver', {
          winner: game.winner,
          reason: winnerResult.reason
        });
      }
    
      acknowledge({ success: true, updatedPieces: game.board.pieces, formedMill });
    });  */
    /* socket.on('movePiece', async ({ gameId, pieceId, newPosition, playerId }, acknowledge) => {
        console.log('🟢 Received movePiece request:', { gameId, pieceId, newPosition, playerId });
        function checkForMill(position, player, pieces) {
            const mills = [
                // horizontal
              [{x: 0, y: 0}, {x: 3, y: 0}, {x: 6, y: 0}],
              [{x: 1, y: 1}, {x: 3, y: 1}, {x: 5, y: 1}],
              [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}],
              [{x: 1, y: 5}, {x: 3, y: 5}, {x: 5, y: 5}],
              [{x: 2, y: 4}, {x: 3, y: 4}, {x: 4, y: 4}],
               [{x: 0, y:6},  {x: 3, y: 6}, {x:6 , y: 6}],

    
    
    // Vertical across squares
    [{x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}],
    [{x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6}],
    [{x: 0, y: 3}, {x: 1, y: 3}, {x: 2, y: 3}],
    [{x: 4, y: 3}, {x: 5, y: 3}, {x: 6, y: 3}],
    [{x: 0, y: 0}, {x: 0, y: 3}, {x: 0, y: 6}],
    [{x: 1, y: 1}, {x: 1, y: 3}, {x: 1, y: 5}],
    [{x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}],
    [{x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}],
    [{x: 5, y: 1}, {x: 5, y: 3}, {x: 5, y: 5}],
    [{x:6 , y:0 }, {x:6 ,y :3 }, {x :6 ,y :6}],
    


    
    // ✅ Diagonal mills
    [{x: 0, y: 0}, {x: 1, y: 1}, {x: 2, y: 2}],
    [{x:6 , y: 0 },{x: 5, y: 1},{x: 4, y: 2}],
    [{x: 6, y: 6}, {x: 5, y: 5}, {x: 4, y: 4}],
    [{x: 0, y: 6}, {x: 1, y: 5}, {x: 2, y: 4}],
            ];
            return mills.some(line => line.every(pos => pieces.some(p => p.player === player &&
                p.position.x === pos.x &&
                p.position.y === pos.y)) &&
                line.some(pos => pos.x === position.x && pos.y === position.y) // must include the moved position
            );
        }
        const game = await Game.findById(gameId);
        if (!game) {
            console.log('❌ Game not found:', gameId);
            return acknowledge({ success: false, error: "Game not found" });
        }
        // Log game state for debugging
        console.log('🔍 Game state:', {
            phase: game.phase,
            redPlayer: game.players.red.toString(),
            bluePlayer: game.players.blue.toString(),
            currentTurn: game.currentTurn.toString()
        });
        // Use string comparison for more reliable player color determination
        const currentPlayerColor = game.players.red.toString() === game.currentTurn.toString() ? 'red' : 'blue';
        console.log('🔍 Current player color:', currentPlayerColor);
        // Find the piece being moved
        const piece = game.board.pieces.find(p => p.id === pieceId && p.player === currentPlayerColor);
        if (!piece) {
            console.log('❌ Invalid piece move. Piece:', pieceId, 'Current player:', currentPlayerColor);
            console.log('Available pieces for current player:', game.board.pieces.filter(p => p.player === currentPlayerColor).map(p => p.id));
            return acknowledge({ success: false, error: "Invalid piece" });
        }
        function canMoveTo(pos1, pos2, boardPieces, gamePhase, playerPiecesCount) {
            // Log the values for debugging
            const dx = Math.abs(pos1.x - pos2.x);
            const dy = Math.abs(pos1.y - pos2.y);
            console.log(`🔍 Checking move from (${pos1.x},${pos1.y}) to (${pos2.x},${pos2.y})`);
            console.log(`🔍 dx: ${dx}, dy: ${dy}, phase: ${gamePhase}`);
            // Check if destination is occupied
            const isEmpty = !boardPieces.some(p => p.position.x === pos2.x && p.position.y === pos2.y);
            if (!isEmpty) {
                console.log('❌ Position is occupied');
                return false;
            }
            // In 12 Men's Morris, players can "fly" (move to any empty position) when they have 3 pieces left
            if (gamePhase === 'flying' || playerPiecesCount <= 3) {
                console.log('🟢 Flying is allowed - can move anywhere');
                return true;
            }
            // Check if positions are adjacent in any direction (horizontally, vertically or diagonally)
            // This allows movement in all directions as requested
            if (gamePhase === 'moving') {
                // Allow movement in any direction (up, down, left, right, diagonal)
                // We just need to check that the position is valid on the board
                const isValidPosition = isValidBoardPosition(pos2);
                if (isValidPosition) {
                    console.log('🟢 Movement in any direction is allowed in moving phase');
                    return true;
                }
            }
            else {
                // For other phases, use the original adjacency logic
                const isValidConnection = isAdjacentOnBoard(pos1, pos2);
                console.log(`🟢 Is valid connection: ${isValidConnection}`);
                return isValidConnection;
            }
            return false;
        }
        function isValidBoardPosition(pos) {
            // Define valid positions on a 12 Men's Morris board
            const validPositions = [
                // Outer square
                { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 },
                { x: 0, y: 3 }, { x: 6, y: 3 },
                { x: 0, y: 6 }, { x: 3, y: 6 }, { x: 6, y: 6 },
                // Middle square
                { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 1 },
                { x: 1, y: 3 }, { x: 5, y: 3 },
                { x: 1, y: 5 }, { x: 3, y: 5 }, { x: 5, y: 5 },
                // Inner square
                { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
                { x: 2, y: 3 }, { x: 4, y: 3 },
                { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
            ];
            return validPositions.some(p => p.x === pos.x && p.y === pos.y);
        }
        function isAdjacentOnBoard(pos1, pos2) {
            // Define all valid connections on a 12 Men's Morris board
            const connections = [
                // Outer square
                [{ x: 0, y: 0 }, { x: 3, y: 0 }], [{ x: 3, y: 0 }, { x: 6, y: 0 }],
                [{ x: 0, y: 0 }, { x: 0, y: 3 }], [{ x: 6, y: 0 }, { x: 6, y: 3 }],
                [{ x: 0, y: 6 }, { x: 3, y: 6 }], [{ x: 3, y: 6 }, { x: 6, y: 6 }],
                [{ x: 0, y: 3 }, { x: 0, y: 6 }], [{ x: 6, y: 3 }, { x: 6, y: 6 }],
                // Middle square
                [{ x: 1, y: 1 }, { x: 3, y: 1 }], [{ x: 3, y: 1 }, { x: 5, y: 1 }],
                [{ x: 1, y: 1 }, { x: 1, y: 3 }], [{ x: 5, y: 1 }, { x: 5, y: 3 }],
                [{ x: 1, y: 5 }, { x: 3, y: 5 }], [{ x: 3, y: 5 }, { x: 5, y: 5 }],
                [{ x: 1, y: 3 }, { x: 1, y: 5 }], [{ x: 5, y: 3 }, { x: 5, y: 5 }],
                // Inner square
                [{ x: 2, y: 2 }, { x: 3, y: 2 }], [{ x: 3, y: 2 }, { x: 4, y: 2 }],
                [{ x: 2, y: 2 }, { x: 2, y: 3 }], [{ x: 4, y: 2 }, { x: 4, y: 3 }],
                [{ x: 2, y: 4 }, { x: 3, y: 4 }], [{ x: 3, y: 4 }, { x: 4, y: 4 }],
                [{ x: 2, y: 3 }, { x: 2, y: 4 }], [{ x: 4, y: 3 }, { x: 4, y: 4 }],
                // Connecting lines
                [{ x: 0, y: 3 }, { x: 1, y: 3 }], [{ x: 1, y: 3 }, { x: 2, y: 3 }],
                [{ x: 4, y: 3 }, { x: 5, y: 3 }], [{ x: 5, y: 3 }, { x: 6, y: 3 }],
                [{ x: 3, y: 0 }, { x: 3, y: 1 }], [{ x: 3, y: 1 }, { x: 3, y: 2 }],
                [{ x: 3, y: 4 }, { x: 3, y: 5 }], [{ x: 3, y: 5 }, { x: 3, y: 6 }]
            ];
            // Check if the move is along one of the valid connections
            for (const [p1, p2] of connections) {
                if ((p1.x === pos1.x && p1.y === pos1.y && p2.x === pos2.x && p2.y === pos2.y) ||
                    (p2.x === pos1.x && p2.y === pos1.y && p1.x === pos2.x && p1.y === pos2.y)) {
                    return true;
                }
            }
            return false;
        }
        // Count the player's remaining pieces
        const playerPiecesCount = game.board.pieces.filter(p => p.player === currentPlayerColor).length;
        // Check if the move is valid
        const isValidMove = canMoveTo(piece.position, // Current position
        newPosition, // Target position
        game.board.pieces, // All pieces on board
        game.phase, // Game phase
        playerPiecesCount // Player's piece count
        );
        if (!isValidMove) {
            console.log('❌ Invalid move');
            return acknowledge({ success: false, error: "Invalid move" });
        }
        // ✅ Update position
        piece.position = newPosition;
        console.log(`🟢 Moved piece ${pieceId} to:`, newPosition);
        // ✅ Check for mill
        const formedMill = checkForMill(newPosition, currentPlayerColor, game.board.pieces);
        console.log('🟢 Mill formed:', formedMill);
        if (formedMill) {
            game.phase = 'removing'; // set phase to removing
            // Keep the current player's turn
            console.log('🟢 Mill formed! Entering removing phase. Current turn remains with player:', currentPlayerColor);
        }
        else {
            // Switch to the other player's turn
            game.phase = 'moving';
            // Use string comparison for more reliable switching
            const nextPlayer = game.players.red.toString() === game.currentTurn.toString() ?
                game.players.blue :
                game.players.red;
            game.currentTurn = nextPlayer;
            const nextPlayerColor = nextPlayer.toString() === game.players.red.toString() ? 'red' : 'blue';
            console.log('🟢 No mill. Switching turn to player:', nextPlayerColor);
        }
        // ✅ Check for winner after a move (only when no mill is formed)
        let winnerResult;
        if (typeof checkForWinner === 'function') {
            winnerResult = checkForWinner(game);
            if (winnerResult) {
                game.winner = winnerResult.winner;
                console.log(`🏆 Winner detected: ${game.winner}`);
            }
        }
        await game.save();
        // Log the game state after update for debugging
        console.log('🔍 Updated game state:', {
            phase: game.phase,
            currentTurn: game.currentTurn.toString(),
            currentPlayer: game.currentTurn.toString() === game.players.red.toString() ? 'red' : 'blue'
        });
        io.to(gameId).emit('pieceMoved', {
            updatedPieces: game.board.pieces,
            currentTurn: game.currentTurn,
            formedMill,
            phase: game.phase,
            winner: game.winner // Include winner info if set
        });
        // If there's a winner, also emit a specific gameOver event
        if (game.winner) {
            io.to(gameId).emit('gameOver', {
                winner: game.winner,
                reason: winnerResult ? winnerResult.reason : 'Game ended'
            });
        }
        acknowledge({ success: true, updatedPieces: game.board.pieces, formedMill });
    }); */
   
    socket.on('movePiece', async ({ gameId, pieceId, newPosition, playerId }, acknowledge) => {
      console.log('🟢 Received movePiece request:', { gameId, pieceId, newPosition, playerId });
    
      function checkForMill(position, player, pieces) {
        const mills = [
          [{x: 0, y: 0}, {x: 3, y: 0}, {x: 6, y: 0}],
          [{x: 1, y: 1}, {x: 3, y: 1}, {x: 5, y: 1}],
          [{x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}],
          [{x: 1, y: 5}, {x: 3, y: 5}, {x: 5, y: 5}],
          [{x: 2, y: 4}, {x: 3, y: 4}, {x: 4, y: 4}],
          [{x: 0, y: 6}, {x: 3, y: 6}, {x: 6, y: 6}],
          [{x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}],
          [{x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6}],
          [{x: 0, y: 3}, {x: 1, y: 3}, {x: 2, y: 3}],
          [{x: 4, y: 3}, {x: 5, y: 3}, {x: 6, y: 3}],
          [{x: 0, y: 0}, {x: 0, y: 3}, {x: 0, y: 6}],
          [{x: 1, y: 1}, {x: 1, y: 3}, {x: 1, y: 5}],
          [{x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}],
          [{x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}],
          [{x: 5, y: 1}, {x: 5, y: 3}, {x: 5, y: 5}],
          [{x: 6, y: 0}, {x: 6, y: 3}, {x: 6, y: 6}],
          [{x: 0, y: 0}, {x: 1, y: 1}, {x: 2, y: 2}],
          [{x: 6, y: 0}, {x: 5, y: 1}, {x: 4, y: 2}],
          [{x: 6, y: 6}, {x: 5, y: 5}, {x: 4, y: 4}],
          [{x: 0, y: 6}, {x: 1, y: 5}, {x: 2, y: 4}],
        ];
        return mills.some(line =>
          line.every(pos =>
            pieces.some(p => p.player === player && p.position.x === pos.x && p.position.y === pos.y)
          ) &&
          line.some(pos => pos.x === position.x && pos.y === position.y)
        );
      }
    
      const game = await Game.findById(gameId);
      if (!game) return acknowledge({ success: false, error: "Game not found" });
    
      const currentPlayerColor = game.players.red.toString() === game.currentTurn.toString() ? 'red' : 'blue';
      const piece = game.board.pieces.find(p => p.id === pieceId && p.player === currentPlayerColor);
      if (!piece) return acknowledge({ success: false, error: "Invalid piece" });
    
      const playerPiecesCount = game.board.pieces.filter(p => p.player === currentPlayerColor).length;
    
      function isValidBoardPosition(pos) {
        const validPositions = [
          { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 },
          { x: 0, y: 3 }, { x: 6, y: 3 },
          { x: 0, y: 6 }, { x: 3, y: 6 }, { x: 6, y: 6 },
          { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 1 },
          { x: 1, y: 3 }, { x: 5, y: 3 },
          { x: 1, y: 5 }, { x: 3, y: 5 }, { x: 5, y: 5 },
          { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
          { x: 2, y: 3 }, { x: 4, y: 3 },
          { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
        ];
        return validPositions.some(p => p.x === pos.x && p.y === pos.y);
      }
    
      // Define the adjacency connections for Nine Men's Morris board
      // Based on the standard board layout with coordinates (0,0) to (6,6)
      function getAdjacentPositions(pos) {
        const adjacencies = {
          // Outer ring corners
          '0,0': [{x: 3, y: 0}, {x: 0, y: 3}],
          '6,0': [{x: 3, y: 0}, {x: 6, y: 3}],
          '6,6': [{x: 6, y: 3}, {x: 3, y: 6}],
          '0,6': [{x: 0, y: 3}, {x: 3, y: 6}],
          
          // Outer ring midpoints
          '3,0': [{x: 0, y: 0}, {x: 6, y: 0}, {x: 3, y: 1}],
          '6,3': [{x: 6, y: 0}, {x: 6, y: 6}, {x: 5, y: 3}],
          '3,6': [{x: 6, y: 6}, {x: 0, y: 6}, {x: 3, y: 5}],
          '0,3': [{x: 0, y: 6}, {x: 0, y: 0}, {x: 1, y: 3}],
          
          // Middle ring corners
          '1,1': [{x: 3, y: 1}, {x: 1, y: 3}],
          '5,1': [{x: 3, y: 1}, {x: 5, y: 3}],
          '5,5': [{x: 5, y: 3}, {x: 3, y: 5}],
          '1,5': [{x: 1, y: 3}, {x: 3, y: 5}],
          
          // Middle ring midpoints
          '3,1': [{x: 3, y: 0}, {x: 1, y: 1}, {x: 5, y: 1}, {x: 3, y: 2}],
          '5,3': [{x: 6, y: 3}, {x: 5, y: 1}, {x: 5, y: 5}, {x: 4, y: 3}],
          '3,5': [{x: 3, y: 6}, {x: 5, y: 5}, {x: 1, y: 5}, {x: 3, y: 4}],
          '1,3': [{x: 0, y: 3}, {x: 1, y: 5}, {x: 1, y: 1}, {x: 2, y: 3}],
          
          // Inner ring corners
          '2,2': [{x: 3, y: 2}, {x: 2, y: 3}],
          '4,2': [{x: 3, y: 2}, {x: 4, y: 3}],
          '4,4': [{x: 4, y: 3}, {x: 3, y: 4}],
          '2,4': [{x: 2, y: 3}, {x: 3, y: 4}],
          
          // Inner ring midpoints
          '3,2': [{x: 3, y: 1}, {x: 2, y: 2}, {x: 4, y: 2}],
          '4,3': [{x: 5, y: 3}, {x: 4, y: 2}, {x: 4, y: 4}],
          '3,4': [{x: 3, y: 5}, {x: 4, y: 4}, {x: 2, y: 4}],
          '2,3': [{x: 1, y: 3}, {x: 2, y: 4}, {x: 2, y: 2}]
        };
        
        const key = `${pos.x},${pos.y}`;
        const adjacent = adjacencies[key] || [];
        console.log(`🔍 Getting adjacent positions for ${key}:`, adjacent);
        return adjacent;
      }
    
      function canMoveTo(fromPos, toPos, boardPieces, gamePhase, playerPiecesCount) {
        console.log('🔍 Checking move validity:', {
          from: fromPos,
          to: toPos,
          gamePhase,
          playerPiecesCount
        });
    
        // Check if destination is empty
        const isEmpty = !boardPieces.some(p => p.position.x === toPos.x && p.position.y === toPos.y);
        if (!isEmpty) {
          console.log('❌ Destination is occupied');
          return false;
        }
    
        // Check if destination is valid board position
        if (!isValidBoardPosition(toPos)) {
          console.log('❌ Invalid board position');
          return false;
        }
    
        // Flying phase: can move to any empty position
        if (gamePhase === 'flying' || playerPiecesCount <= 3) {
          console.log('✅ Flying phase - move allowed');
          return true;
        }
    
        // Moving phase: can only move to adjacent positions
        if (gamePhase === 'moving') {
          const adjacentPositions = getAdjacentPositions(fromPos);
          console.log('🔍 Adjacent positions for', fromPos, ':', adjacentPositions);
          const isAdjacent = adjacentPositions.some(pos => pos.x === toPos.x && pos.y === toPos.y);
          console.log('🔍 Is adjacent move?', isAdjacent);
          return isAdjacent;
        }
    
        console.log('❌ Unknown game phase');
        return false;
      }
    
      console.log('🔍 Move validation details:', {
        piecePosition: piece.position,
        newPosition,
        gamePhase: game.phase,
        playerPiecesCount,
        currentPlayerColor
      });
    
      const isValidMove = canMoveTo(piece.position, newPosition, game.board.pieces, game.phase, playerPiecesCount);
      if (!isValidMove) {
        console.log('❌ Move validation failed');
        return acknowledge({ success: false, error: "Invalid move" });
      }
    
      piece.position = newPosition;
      const formedMill = checkForMill(newPosition, currentPlayerColor, game.board.pieces);
    
      if (formedMill) {
        game.phase = 'removing';
      } else {
        game.phase = 'moving';
        game.currentTurn = game.players.red.toString() === game.currentTurn.toString() ? game.players.blue : game.players.red;
      }
    
      let winnerResult;
      if (typeof checkForWinner === 'function') {
        winnerResult = checkForWinner(game);
        if (winnerResult) game.winner = winnerResult.winner;
      }
    
      await game.save();
    
      io.to(gameId).emit('pieceMoved', {
        updatedPieces: game.board.pieces,
        currentTurn: game.currentTurn,
        formedMill,
        phase: game.phase,
        winner: game.winner
      });
    
      if (game.winner) {
        io.to(gameId).emit('gameOver', {
          winner: game.winner,
          reason: winnerResult ? winnerResult.reason : 'Game ended'
        });
      }
    
      acknowledge({ success: true, updatedPieces: game.board.pieces, formedMill });
    });
    
   
    socket.on("gameOver", ({ winner, reason }) => {
        console.log(`Game Over. Winner: ${winner}. Reason: ${reason}`);
    });

   /*  //forfeit game
    socket.on("forfeitGame", async ({ gameId, playerId }, callback) => {
      try {
        console.log("📥 Received forfeitGame:", { gameId, playerId });
        
        const game = await Game 
          .findById(gameId)
          .populate('players.red players.blue');
          
        if (!game) {
          console.error("❌ Game not found");
          return callback({ success: false, error: "Game not found" });   
        }
        
        const player = getPlayerById(game.players, playerId);
        if (!player) {
          console.error("❌ Player not found in this game");
          return callback({ success: false, error: "Player not found in this game" });
        }
        
        // Check if game is already finished
        if (game.phase === 'gameOver') {
          console.error("❌ Game is already finished");
          return callback({ success: false, error: "Game is already finished" });
        }
        
        console.log(`🟢 Player ${playerId} forfeited the game`);
        
        // Store original values for the event
        const forfeitingPlayer = player.player; // 'red' or 'blue'
        const winningPlayer = player.player === 'red' ? 'blue' : 'red';
        
        // Update game state
        game.winner = winningPlayer; // Set the other player as the winner
        game.phase = 'gameOver'; // Set phase to gameOver
        game.forfeitedBy = playerId;
        game.endedAt = new Date();
        game.endReason = 'forfeit';
        
        await game.save();
        console.log("💾 Game updated with forfeit and winner");
        
        // Emit gameForfeited event to all players in the room
        const forfeitData = {
          gameId: game._id,
          forfeitedBy: playerId,
          forfeitingPlayer: forfeitingPlayer,
          winner: winningPlayer,
          winnerPlayerId: forfeitingPlayer === 'red' ? game.players.blue?._id : game.players.red?._id,
          endedAt: game.endedAt,
          message: `${forfeitingPlayer} player has forfeited the game`,
          game: {
            _id: game._id,
            winner: game.winner,
            phase: game.phase,
            endReason: game.endReason,
            forfeitedBy: game.forfeitedBy
          }
        };
        
        // Emit to the game room (all players)
        io.to(gameId).emit('gameForfeited', forfeitData);
        
        // Also emit to the specific player who forfeited (in case they're not in the room)
        socket.emit('gameForfeited', forfeitData);
        
        console.log("📡 Emitted gameForfeited event:", forfeitData);
        
        // Send success callback
        callback({ 
          success: true, 
          message: "Game forfeited successfully",
          winner: winningPlayer,
          forfeitedBy: playerId
        });
        
      } catch (error) {
        console.error("🔥 Forfeit failed:", error);
        return callback({ success: false, error: error.message });
      }
    }); */

    socket.on("forfeitGame", async ({ gameId, playerId }, callback) => {
        try {
          console.log("📥 Received forfeitGame:", { gameId, playerId });
      
          const game = await Game
            .findById(gameId)
            .populate('players.red players.blue');
      
          if (!game) {
            console.error("❌ Game not found");
            return callback({ success: false, error: "Game not found" });
          }
      
          // Identify forfeiting and winning player
          let forfeitingPlayer = null;
          let winningPlayer = null;
      
          if (game.players.red?._id?.toString() === playerId.toString()) {
            forfeitingPlayer = 'red';
            winningPlayer = 'blue';
          } else if (game.players.blue?._id?.toString() === playerId.toString()) {
            forfeitingPlayer = 'blue';
            winningPlayer = 'red';
          } else {
            console.error("❌ Player not found in this game");
            return callback({ success: false, error: "Player not found in this game" });
          }
      
          if (game.phase === 'gameOver') {
            console.error("❌ Game is already finished");
            return callback({ success: false, error: "Game is already finished" });
          }
      
          console.log(`🟢 Player ${playerId} forfeited as ${forfeitingPlayer}`);
      
          // Update game
          game.winner = game.players[winningPlayer]?._id;
          game.phase = 'gameOver';
          game.forfeitedBy = playerId;
          game.endedAt = new Date();
          game.endReason = 'forfeit';
      
          await game.save();
          console.log("💾 Game updated with forfeit and winner");
      
          const forfeitData = {
            gameId: game._id,
            forfeitedBy: playerId,
            forfeitingPlayer,
            winner: winningPlayer,
            winnerPlayerId: game.players[winningPlayer]?._id,
            endedAt: game.endedAt,
            message: `${forfeitingPlayer} player has forfeited the game`,
            game: {
              _id: game._id,
              winner: game.winner,
              phase: game.phase,
              endReason: game.endReason,
              forfeitedBy: game.forfeitedBy
            }
          };
      
          io.to(gameId).emit('gameForfeited', forfeitData);
          socket.emit('gameForfeited', forfeitData);
      
          console.log("📡 Emitted gameForfeited:", forfeitData);
      
          callback({ 
            success: true, 
            message: "Game forfeited successfully",
            winner: winningPlayer,
            forfeitedBy: playerId
          });
      
        } catch (error) {
          console.error("🔥 Forfeit failed:", error);
          return callback({ success: false, error: error.message });
        }
      });
      
});
export { io, app, server };
