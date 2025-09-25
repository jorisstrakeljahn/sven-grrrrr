const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3000;

// Serve static files
app.use(express.static(__dirname));

// Serve the multiplayer game on root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'multiplayer-racing.html'));
});

// Game state
const gameState = {
    players: {},
    obstacles: [],
    boostPads: [],
    gameStarted: false
};

// Game room management
let playerCount = 0;
const MAX_PLAYERS = 2;

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Handle player join
    socket.on('joinGame', (playerData) => {
        if (playerCount >= MAX_PLAYERS) {
            socket.emit('gameFull');
            return;
        }

        playerCount++;
        const playerNum = playerCount;

        gameState.players[socket.id] = {
            id: socket.id,
            playerNum: playerNum,
            x: 200, // Center of 400px canvas
            y: 500, // Near bottom
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
            name: playerData.name || `Player ${playerNum}`,
            input: { up: false, down: false, left: false, right: false }
        };

        socket.emit('playerAssigned', {
            playerNum: playerNum,
            playerId: socket.id
        });

        // Start game when we have 2 players
        if (playerCount === MAX_PLAYERS) {
            gameState.gameStarted = true;
            io.emit('gameStart');
            startGameLoop();
        }

        // Send current game state to all players
        io.emit('gameState', gameState);
    });

    // Handle player input
    socket.on('playerInput', (inputData) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].input = inputData;
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete gameState.players[socket.id];
        playerCount--;

        if (playerCount === 0) {
            gameState.gameStarted = false;
            // Reset game state
            gameState.obstacles = [];
            gameState.boostPads = [];
        }

        io.emit('gameState', gameState);
    });
});

// Game loop
function startGameLoop() {
    const gameLoop = setInterval(() => {
        if (!gameState.gameStarted || playerCount === 0) {
            clearInterval(gameLoop);
            return;
        }

        updateGame();
        io.emit('gameState', gameState);
    }, 1000 / 60); // 60 FPS
}

function updateGame() {
    // Update players based on their input
    Object.values(gameState.players).forEach(player => {
        updatePlayer(player);
    });

    // Create obstacles
    if (Math.random() < 0.01) {
        createObstacles();
    }

    // Create boost pads
    if (Math.random() < 0.005) {
        createBoostPads();
    }

    // Update obstacles
    updateObstacles();

    // Update boost pads
    updateBoostPads();

    // Check collisions
    checkCollisions();
}

function updatePlayer(player) {
    if (!player.input) return;

    const input = player.input;

    // Initialize turnSpeed if not exists
    if (player.turnSpeed === undefined) {
        player.turnSpeed = 0;
    }

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

    // Update score
    const speedPoints = Math.floor(Math.abs(player.speed) * 0.1);
    player.score += speedPoints * player.multiplier;

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

function createObstacles() {
    // Create obstacles for each player
    Object.values(gameState.players).forEach(player => {
        const obstacle = {
            id: Date.now() + Math.random(),
            x: Math.random() * 320 + 40,
            y: -50,
            width: 30,
            height: 60,
            speed: 2 + Math.random() * 3,
            playerNum: player.playerNum
        };
        gameState.obstacles.push(obstacle);
    });
}

function createBoostPads() {
    // Create boost pads for each player
    Object.values(gameState.players).forEach(player => {
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
        gameState.boostPads.push(boostPad);
    });
}

function updateObstacles() {
    gameState.obstacles = gameState.obstacles.filter(obstacle => {
        obstacle.y += obstacle.speed + 3; // Base movement speed

        // Remove if off screen
        if (obstacle.y > 650) {
            // Give survival points
            const player = Object.values(gameState.players)
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

function updateBoostPads() {
    gameState.boostPads = gameState.boostPads.filter(pad => {
        pad.y += pad.speed + 3;
        return pad.y <= 650;
    });
}

function checkCollisions() {
    Object.values(gameState.players).forEach(player => {
        // Check obstacle collisions
        gameState.obstacles.forEach(obstacle => {
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

                    // Collision penalty
                    player.speed *= 0.3;
                    player.velocityX *= -0.5;
                    player.velocityY *= -0.5;
                    const penalty = -50 - (player.streak * 5);
                    player.score += penalty;
                    player.streak = 0;
                    player.multiplier = 1;
                    player.nearMissCount = 0;
                    obstacle.y = 700; // Remove obstacle
                }
                // Near miss
                else if (distance < 80 && obstacle.y > player.y - 100 && obstacle.y < player.y + 100) {
                    if (!obstacle.nearMissAwarded) {
                        const nearMissPoints = 25 * player.multiplier;
                        player.score += nearMissPoints;
                        player.nearMissCount++;
                        obstacle.nearMissAwarded = true;

                        // Perfect streak
                        if (player.nearMissCount >= 3) {
                            const perfectPoints = 100 * player.multiplier;
                            player.score += perfectPoints;
                            player.nearMissCount = 0;
                            player.perfectCount++;
                        }
                    }
                }
            }
        });

        // Check boost pad collisions
        gameState.boostPads.forEach(pad => {
            if (pad.playerNum === player.playerNum && !pad.used &&
                player.x < pad.x + pad.width &&
                player.x + player.width > pad.x &&
                player.y < pad.y + pad.height &&
                player.y + player.height > pad.y) {

                // Activate boost
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Racing game server running on http://localhost:${PORT}`);
    console.log(`Network access: http://<your-ip-address>:${PORT}`);
});
