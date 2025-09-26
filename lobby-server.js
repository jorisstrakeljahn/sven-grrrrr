const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Serve the lobby game on root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'lobby-racing.html'));
});

// Also serve on /lobby route for clarity
app.get('/lobby', (req, res) => {
    res.sendFile(path.join(__dirname, 'lobby-racing.html'));
});

// Game state management
const lobbies = new Map();
const playerSockets = new Map(); // Track which socket belongs to which lobby

// Lobby class
class GameLobby {
    constructor(id, name, creatorId, creatorName) {
        this.id = id;
        this.name = name;
        this.players = {};
        this.gameStarted = false;
        this.gameState = {
            obstacles: [],
            boostPads: [],
            roadOffset: 0
        };
        this.gameLoop = null;
        this.createdAt = Date.now();

        // Add creator as first player
        this.addPlayer(creatorId, creatorName);
    }

    addPlayer(socketId, playerName) {
        if (Object.keys(this.players).length >= 2) {
            return false; // Lobby full
        }

        const playerNum = Object.keys(this.players).length + 1;

        this.players[socketId] = {
            id: socketId,
            playerNum: playerNum,
            name: playerName,
            x: 200,
            y: 500,
            width: 30,
            height: 60,
            speed: 0,
            maxSpeed: 8,
            angle: 0,
            velocityX: 0,
            velocityY: 0,
            turnSpeed: 0,
            boosting: false,
            boostTime: 0,
            score: 0,
            streak: 0,
            multiplier: 1,
            perfectCount: 0,
            lastObstacleTime: Date.now(),
            comboTimer: 0,
            nearMissCount: 0,
            input: { up: false, down: false, left: false, right: false }
        };

        playerSockets.set(socketId, this.id);

        // Start game when we have 2 players
        if (Object.keys(this.players).length === 2) {
            this.startGame();
        }

        return true;
    }

    removePlayer(socketId) {
        delete this.players[socketId];
        playerSockets.delete(socketId);

        if (Object.keys(this.players).length === 0) {
            // Empty lobby, clean up
            if (this.gameLoop) {
                clearInterval(this.gameLoop);
            }
            return true; // Should be deleted
        }

        // If game was running and now we don't have enough players
        if (this.gameStarted && Object.keys(this.players).length < 2) {
            this.endGame();
        }

        return false;
    }

    startGame() {
        this.gameStarted = true;
        this.gameStartTime = Date.now();
        this.gameDuration = 30000; // 30 seconds in milliseconds
        this.gameEnded = false;

        this.gameState = {
            obstacles: [],
            boostPads: [],
            roadOffset: 0,
            timeRemaining: 30
        };

        // Broadcast game start to lobby players
        Object.keys(this.players).forEach(socketId => {
            io.to(socketId).emit('gameStart');
        });

        // Start game loop
        this.gameLoop = setInterval(() => {
            this.updateGame();
            this.broadcastGameState();
        }, 1000 / 60); // 60 FPS
    }

    finishGame() {
        this.gameEnded = true;

        // Determine winner
        const playerArray = Object.values(this.players);
        playerArray.sort((a, b) => b.score - a.score);

        const winner = playerArray[0];
        const gameResults = {
            winner: winner ? {
                name: winner.name,
                playerNum: winner.playerNum,
                score: Math.floor(winner.score)
            } : null,
            players: playerArray.map(p => ({
                name: p.name,
                playerNum: p.playerNum,
                score: Math.floor(p.score)
            })),
            gameTime: 30
        };

        // Stop game loop
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }

        // Send game results to all players
        Object.keys(this.players).forEach(socketId => {
            io.to(socketId).emit('gameFinished', gameResults);
        });
    }

    restartGame() {
        // Reset player positions and scores for new game
        Object.values(this.players).forEach(player => {
            player.x = 200;
            player.y = 500;
            player.speed = 0;
            player.angle = 0;
            player.velocityX = 0;
            player.velocityY = 0;
            player.score = 0;
            player.streak = 0;
            player.multiplier = 1;
            player.boosting = false;
            player.boostTime = 0;
        });

        // Start new game
        this.startGame();
    }

    endGame() {
        this.gameStarted = false;
        this.gameEnded = false;

        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }

        // Reset player positions and scores
        Object.values(this.players).forEach(player => {
            player.x = 200;
            player.y = 500;
            player.speed = 0;
            player.angle = 0;
            player.score = 0;
            player.streak = 0;
            player.multiplier = 1;
        });

        // Send players back to lobby
        Object.keys(this.players).forEach(socketId => {
            io.to(socketId).emit('returnToLobby');
        });
    }

    updateGame() {
        // Check if game should end
        if (!this.gameEnded) {
            const elapsed = Date.now() - this.gameStartTime;
            const timeRemaining = Math.max(0, Math.ceil((this.gameDuration - elapsed) / 1000));

            this.gameState.timeRemaining = timeRemaining;

            if (timeRemaining <= 0) {
                this.finishGame();
                return;
            }
        }

        // Update players
        Object.values(this.players).forEach(player => {
            this.updatePlayer(player);
        });

        // Create obstacles
        if (Math.random() < 0.01) {
            this.createObstacles();
        }

        // Create boost pads
        if (Math.random() < 0.005) {
            this.createBoostPads();
        }

        // Update obstacles and boost pads
        this.updateObstacles();
        this.updateBoostPads();

        // Check collisions
        this.checkCollisions();
    }

    updatePlayer(player) {
        if (!player.input) return;

        const input = player.input;

        // Handle boost timing
        if (player.boosting) {
            player.boostTime--;
            if (player.boostTime <= 0) {
                player.boosting = false;
                player.maxSpeed = 8;
            }
        }

        // Player acceleration/deceleration
        let targetSpeed = 0;
        if (input.up) {
            targetSpeed = player.boosting ? 15 : player.maxSpeed;
        }
        if (input.down) {
            targetSpeed = -player.maxSpeed / 2;
        }

        // Smooth speed transitions
        const speedDiff = targetSpeed - player.speed;
        player.speed += speedDiff * 0.3;
        player.speed *= 0.95;

        // Improved steering
        const steeringSensitivity = Math.min(1, Math.abs(player.speed) / 4);
        const maxSteer = 4 * steeringSensitivity;

        if (input.left) {
            player.turnSpeed = Math.max(player.turnSpeed - 0.4, -maxSteer);
        } else if (input.right) {
            player.turnSpeed = Math.min(player.turnSpeed + 0.4, maxSteer);
        } else {
            player.turnSpeed *= 0.85;
        }

        // Apply turning
        const turnInfluence = Math.min(1, Math.abs(player.speed) / 3);
        player.angle += (player.turnSpeed * 0.02) * turnInfluence;

        // Physics-based movement
        const forwardX = Math.sin(player.angle);
        const forwardY = -Math.cos(player.angle);

        player.velocityX += forwardX * player.speed * 0.1;
        player.velocityY += forwardY * player.speed * 0.1;

        // Air resistance
        player.velocityX *= 0.95;
        player.velocityY *= 0.95;

        // Update position
        player.x += player.velocityX;
        player.y += player.velocityY;

        // Keep player on screen
        player.x = Math.max(30, Math.min(370, player.x));
        player.y = Math.max(50, Math.min(550, player.y));

        // Update score with visual feedback
        const speedPoints = Math.floor(Math.abs(player.speed) * 0.1);
        player.score += speedPoints * player.multiplier;

        // Add speed bonus visual effects every 60 frames (~1 second)
        if (!player.speedBonusTimer) player.speedBonusTimer = 0;
        player.speedBonusTimer++;

        if (player.speedBonusTimer >= 60 && speedPoints > 0) {
            const bonusPoints = Math.floor(speedPoints * player.multiplier * 5); // Make it visible
            io.to(player.id).emit('scoreEvent', {
                playerId: player.id,
                type: 'speed',
                points: bonusPoints,
                x: player.x,
                y: player.y
            });
            player.speedBonusTimer = 0;
        }

        // Update combo timer and streak decay
        if (player.comboTimer > 0) {
            player.comboTimer--;
            if (player.comboTimer === 0) {
                player.multiplier = Math.max(1, player.multiplier - 0.5);
            }
        }

        if (Date.now() - player.lastObstacleTime > 3000) {
            if (player.streak > 0) {
                player.streak = Math.max(0, player.streak - 1);
                player.multiplier = 1 + (player.streak * 0.2);
            }
            player.lastObstacleTime = Date.now();
        }
    }

    createObstacles() {
        Object.values(this.players).forEach(player => {
            const obstacle = {
                id: Date.now() + Math.random(),
                x: Math.random() * 320 + 40,
                y: -50,
                width: 30,
                height: 60,
                speed: 2 + Math.random() * 3,
                playerNum: player.playerNum
            };
            this.gameState.obstacles.push(obstacle);
        });
    }

    createBoostPads() {
        Object.values(this.players).forEach(player => {
            const boostPad = {
                id: Date.now() + Math.random(),
                x: Math.random() * 280 + 60,
                y: -80,
                width: 60,
                height: 30,
                speed: 2,
                used: false,
                playerNum: player.playerNum
            };
            this.gameState.boostPads.push(boostPad);
        });
    }

    updateObstacles() {
        this.gameState.obstacles = this.gameState.obstacles.filter(obstacle => {
            obstacle.y += obstacle.speed + 3;

            if (obstacle.y > 650) {
                const player = Object.values(this.players)
                    .find(p => p.playerNum === obstacle.playerNum);
                if (player) {
                    const survivalPoints = (5 + player.streak) * player.multiplier;
                    player.score += survivalPoints;
                    player.streak++;
                    player.multiplier = Math.min(5, 1 + (player.streak * 0.2));
                    player.lastObstacleTime = Date.now();
                }
                return false;
            }
            return true;
        });
    }

    updateBoostPads() {
        this.gameState.boostPads = this.gameState.boostPads.filter(pad => {
            pad.y += pad.speed + 3;
            return pad.y <= 650;
        });
    }

    checkCollisions() {
        Object.values(this.players).forEach(player => {
            // Check obstacle collisions
            this.gameState.obstacles.forEach(obstacle => {
                if (obstacle.playerNum === player.playerNum) {
                    const distance = Math.sqrt(
                        Math.pow(player.x + player.width/2 - (obstacle.x + obstacle.width/2), 2) +
                        Math.pow(player.y + player.height/2 - (obstacle.y + obstacle.height/2), 2)
                    );

                    // Direct collision
                    if (player.x < obstacle.x + obstacle.width &&
                        player.x + player.width > obstacle.x &&
                        player.y < obstacle.y + obstacle.height &&
                        player.y + player.height > obstacle.y) {

                        player.speed *= 0.3;
                        player.velocityX *= -0.5;
                        player.velocityY *= -0.5;
                        const penalty = -50 - (player.streak * 5);
                        player.score += penalty;
                        player.streak = 0;
                        player.multiplier = 1;
                        player.nearMissCount = 0;
                        obstacle.y = 700;
                    }
                    // Near miss (very generous conditions for frequent animations)
                    else if (distance < 200 && obstacle.y > player.y - 200 && obstacle.y < player.y + 200) {
                        if (!obstacle.nearMissAwarded) {
                            const nearMissPoints = 25 * player.multiplier;
                            player.score += nearMissPoints;
                            player.nearMissCount++;
                            obstacle.nearMissAwarded = true;

                            // Emit near miss event for visual effects
                            console.log(`Near miss! Player ${player.id} scored ${nearMissPoints} points`);
                            io.to(player.id).emit('scoreEvent', {
                                playerId: player.id,
                                type: 'nearMiss',
                                points: nearMissPoints,
                                x: player.x,
                                y: player.y
                            });

                            if (player.nearMissCount >= 2) {
                                const perfectPoints = 100 * player.multiplier;
                                player.score += perfectPoints;
                                player.nearMissCount = 0;
                                player.perfectCount++;

                                // Emit perfect event for visual effects
                                console.log(`Perfect! Player ${player.id} scored ${perfectPoints} points`);
                                io.to(player.id).emit('scoreEvent', {
                                    playerId: player.id,
                                    type: 'perfect',
                                    points: perfectPoints,
                                    x: player.x,
                                    y: player.y
                                });
                            }
                        }
                    }
                }
            });

            // Check boost pad collisions
            this.gameState.boostPads.forEach(pad => {
                if (pad.playerNum === player.playerNum && !pad.used &&
                    player.x < pad.x + pad.width &&
                    player.x + player.width > pad.x &&
                    player.y < pad.y + pad.height &&
                    player.y + player.height > pad.y) {

                    player.boosting = true;
                    player.boostTime = 180;
                    player.maxSpeed = 15;
                    pad.used = true;

                    const boostPoints = (50 + (player.streak * 10)) * player.multiplier;
                    player.score += boostPoints;
                    player.streak++;
                    player.multiplier = Math.min(5, 1 + (player.streak * 0.2));
                    player.comboTimer = 300;
                    player.lastObstacleTime = Date.now();
                }
            });
        });
    }

    broadcastGameState() {
        const gameData = {
            players: this.players,
            obstacles: this.gameState.obstacles,
            boostPads: this.gameState.boostPads,
            timeRemaining: this.gameState.timeRemaining
        };

        Object.keys(this.players).forEach(socketId => {
            io.to(socketId).emit('gameState', gameData);
        });
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            players: this.players,
            gameStarted: this.gameStarted,
            createdAt: this.createdAt
        };
    }
}

// Socket connections
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Send current lobbies
    socket.on('getLobbies', () => {
        const lobbyInfo = {};
        lobbies.forEach((lobby, id) => {
            lobbyInfo[id] = lobby.getInfo();
        });
        socket.emit('lobbiesUpdate', lobbyInfo);
    });

    // Create lobby
    socket.on('createLobby', (data) => {
        const lobbyId = uuidv4();
        const lobby = new GameLobby(lobbyId, data.lobbyName, socket.id, data.playerName);
        lobbies.set(lobbyId, lobby);

        socket.emit('joinedLobby', {
            lobbyId: lobbyId,
            lobbyName: data.lobbyName,
            playerNum: 1
        });

        // Broadcast lobby list update
        broadcastLobbyUpdates();

        console.log(`Lobby created: ${data.lobbyName} by ${data.playerName}`);
    });

    // Join lobby
    socket.on('joinLobby', (data) => {
        const lobby = lobbies.get(data.lobbyId);

        if (!lobby) {
            socket.emit('lobbyNotFound');
            return;
        }

        if (lobby.addPlayer(socket.id, data.playerName)) {
            socket.emit('joinedLobby', {
                lobbyId: data.lobbyId,
                lobbyName: lobby.name,
                playerNum: Object.keys(lobby.players).length
            });

            broadcastLobbyUpdates();
            console.log(`${data.playerName} joined lobby: ${lobby.name}`);
        } else {
            socket.emit('lobbyFull');
        }
    });

    // Leave lobby
    socket.on('leaveLobby', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (lobby) {
            const shouldDelete = lobby.removePlayer(socket.id);

            if (shouldDelete) {
                lobbies.delete(lobbyId);
                console.log(`Lobby deleted: ${lobby.name}`);
            }

            broadcastLobbyUpdates();
        }
    });

    // Handle player input
    socket.on('playerInput', (data) => {
        const lobbyId = playerSockets.get(socket.id);
        const lobby = lobbies.get(lobbyId);

        if (lobby && lobby.players[socket.id]) {
            lobby.players[socket.id].input = data.input;
        }
    });

    // Handle restart game
    socket.on('restartGame', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (lobby && lobby.players[socket.id] && lobby.gameEnded) {
            lobby.restartGame();
        }
    });

    // Handle back to lobby from game results
    socket.on('backToLobbyFromResults', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (lobby && lobby.players[socket.id]) {
            lobby.endGame();
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);

        const lobbyId = playerSockets.get(socket.id);
        if (lobbyId) {
            const lobby = lobbies.get(lobbyId);
            if (lobby) {
                const shouldDelete = lobby.removePlayer(socket.id);

                if (shouldDelete) {
                    lobbies.delete(lobbyId);
                    console.log(`Lobby deleted due to disconnect`);
                }

                broadcastLobbyUpdates();
            }
        }
    });
});

// Helper function to broadcast lobby updates
function broadcastLobbyUpdates() {
    const lobbyInfo = {};
    lobbies.forEach((lobby, id) => {
        lobbyInfo[id] = lobby.getInfo();
    });

    io.emit('lobbiesUpdate', lobbyInfo);
}

// Clean up empty lobbies periodically
setInterval(() => {
    const now = Date.now();
    const toDelete = [];

    lobbies.forEach((lobby, id) => {
        // Delete empty lobbies older than 10 minutes
        if (Object.keys(lobby.players).length === 0 && (now - lobby.createdAt) > 10 * 60 * 1000) {
            toDelete.push(id);
        }
    });

    toDelete.forEach(id => {
        console.log(`Cleaning up old empty lobby: ${id}`);
        lobbies.delete(id);
    });

    if (toDelete.length > 0) {
        broadcastLobbyUpdates();
    }
}, 5 * 60 * 1000); // Check every 5 minutes

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Racing lobby server running on http://localhost:${PORT}`);
    console.log(`Network access: http://<your-ip-address>:${PORT}`);
});