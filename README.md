# 🏎️ Multiplayer Racing Game

A real-time multiplayer racing game that can be played over your local network!

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```

### 3. Connect Players
- **Host/Server**: Open `http://localhost:3000`
- **Other Players**: Open `http://YOUR_IP_ADDRESS:3000`

## 🎮 How to Play

### Game Modes
- **Local Split-Screen**: Open `racing-game.html` directly in browser
- **Network Multiplayer**: Use the server setup above

### Controls
- **Player 1**: Arrow Keys (↑↓←→)
- **Player 2**: WASD Keys

### Gameplay
- **🎯 Near Misses**: Get bonus points for close calls with obstacles
- **🔥 Streaks**: Build combos for higher score multipliers (up to 5x!)
- **⚡ Boost Pads**: Collect yellow pads for speed boost and bonus points
- **💥 Collisions**: Avoid obstacles or lose points and reset your streak

## 🌐 Network Setup

### Find Your IP Address

**Windows:**
```bash
ipconfig
```
Look for "IPv4 Address" (usually something like 192.168.1.xxx)

**Mac/Linux:**
```bash
ifconfig
# or
ip addr show
```

### Firewall Setup
Make sure port 3000 is open on your firewall:

**Windows:**
```bash
netsh advfirewall firewall add rule name="Racing Game" dir=in action=allow protocol=TCP localport=3000
```

**Mac:**
```bash
sudo pfctl -e
# Allow incoming connections on port 3000
```

## 🏆 Scoring System

### Point Sources
- **Speed**: Continuous points while driving (multiplied by streak)
- **Survival**: +5+ points per avoided obstacle (streak bonus)
- **Near Miss**: +25+ points for close calls (multiplied)
- **Perfect**: +100+ points for 3 consecutive near misses
- **Boost**: +50+ points plus streak bonus (multiplied)
- **Collision**: -50+ point penalty (bigger loss with higher streaks)

### Multipliers
- Build streaks by avoiding obstacles and collecting boosts
- Streaks increase your point multiplier up to 5x
- Streaks decay after 3 seconds of no activity
- Collisions reset your streak to 0

## 🔧 Technical Details

### Files
- `server.js` - Node.js WebSocket server for multiplayer
- `multiplayer-racing.html` - Network multiplayer client
- `racing-game.html` - Local split-screen version
- `package.json` - Dependencies and scripts

### Network Architecture
- Uses Socket.IO for real-time communication
- Server runs at 60 FPS game loop
- Client renders at browser refresh rate
- Authoritative server prevents cheating

### Features
- Real-time multiplayer (up to 2 players)
- Lag compensation
- Automatic reconnection
- Player name customization
- Live scoring and leaderboard
- Visual effects and animations

## 🐛 Troubleshooting

### Can't Connect to Server
1. Check if server is running (`npm start`)
2. Verify IP address is correct
3. Make sure port 3000 isn't blocked
4. Try `http://localhost:3000` on host machine first

### Game Lag/Stuttering
1. Check network connection quality
2. Close other network-intensive applications
3. Try wired connection instead of Wi-Fi

### Players Can't Join
1. Maximum 2 players supported
2. Check firewall settings
3. Verify IP address is accessible from client machines

## 🎨 Customization

The game is easily customizable:
- Modify colors, speeds, and physics in `server.js`
- Adjust visual effects in the HTML files
- Add new power-ups or obstacles
- Implement different game modes

Have fun racing! 🏁