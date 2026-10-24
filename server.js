const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// Room Storage State
const rooms = {};

function generateRoomCode() {
    let code = '';
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    let currentRoom = null;

    // Create Room
    socket.on('create_room', ({ username }) => {
        const roomCode = generateRoomCode();
        currentRoom = roomCode;

        rooms[roomCode] = {
            hostId: socket.id,
            started: false,
            players: {}
        };

        rooms[roomCode].players[socket.id] = {
            id: socket.id,
            username: username || 'Host Student',
            isHost: true,
            hp: 200,
            x: 0, y: 1.6, z: 4,
            yaw: 0, pitch: 0,
            color: '#3b82f6'
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode, playerId: socket.id });
        io.to(roomCode).emit('lobby_update', rooms[roomCode]);
    });

    // Join Room
    socket.on('join_room', ({ roomCode, username }) => {
        const room = rooms[roomCode];

        if (!room) {
            return socket.emit('error_msg', 'Room code does not exist!');
        }
        if (room.started) {
            return socket.emit('error_msg', 'Match is already in progress!');
        }

        const colors = ['#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
        const pColor = colors[Object.keys(room.players).length % colors.length];

        currentRoom = roomCode;
        room.players[socket.id] = {
            id: socket.id,
            username: username || `Student_${Math.floor(Math.random() * 1000)}`,
            isHost: false,
            hp: 200,
            x: (Math.random() - 0.5) * 6,
            y: 1.6,
            z: (Math.random() - 0.5) * 6,
            yaw: 0, pitch: 0,
            color: pColor
        };

        socket.join(roomCode);
        socket.emit('room_joined', { roomCode, playerId: socket.id });
        io.to(roomCode).emit('lobby_update', room);
    });

    // Host Kicks Player
    socket.on('kick_player', ({ targetId }) => {
        const room = rooms[currentRoom];
        if (room && room.hostId === socket.id && targetId !== socket.id) {
            const kickedSocket = io.sockets.sockets.get(targetId);
            delete room.players[targetId];

            if (kickedSocket) {
                kickedSocket.emit('kicked_from_room');
                kickedSocket.leave(currentRoom);
            }

            io.to(currentRoom).emit('lobby_update', room);
        }
    });

    // Host Starts Match
    socket.on('start_game', () => {
        const room = rooms[currentRoom];
        if (room && room.hostId === socket.id) {
            room.started = true;
            Object.values(room.players).forEach((player) => {
                player.hp = 200;
            });
            io.to(currentRoom).emit('match_started', { players: room.players });
        }
    });

    // 60Hz Player State Sync
    socket.on('player_update', (data) => {
        const room = rooms[currentRoom];
        if (room && room.players[socket.id]) {
            Object.assign(room.players[socket.id], data);
            socket.to(currentRoom).emit('peer_update', {
                id: socket.id,
                ...data
            });
        }
    });

    // Attack / Damage Sync
    socket.on('player_attack', (data) => {
        socket.to(currentRoom).emit('peer_attack', { attackerId: socket.id, ...data });
    });

    socket.on('player_hit', ({ targetId, damage }) => {
        const room = rooms[currentRoom];
        if (room && room.players[targetId]) {
            room.players[targetId].hp = Math.max(0, room.players[targetId].hp - damage);
            io.to(currentRoom).emit('player_damaged', {
                targetId,
                hp: room.players[targetId].hp,
                damage
            });
        }
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            delete room.players[socket.id];

            if (Object.keys(room.players).length === 0) {
                delete rooms[currentRoom];
            } else {
                if (room.hostId === socket.id) {
                    const remaining = Object.keys(room.players);
                    room.hostId = remaining[0];
                    room.players[remaining[0]].isHost = true;
                }
                io.to(currentRoom).emit('lobby_update', room);
                io.to(currentRoom).emit('player_left', socket.id);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
