const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateRoomCode() {
    let code = '';
    do { code = Math.floor(1000 + Math.random() * 9000).toString(); } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('create_room', ({ username, settings }) => {
        const roomCode = generateRoomCode();
        currentRoom = roomCode;

        rooms[roomCode] = {
            hostId: socket.id,
            started: false,
            settings: settings || { classrooms: 1, bathrooms: 1, computers: 1, cafeterias: 1 }, 
            players: {}
        };

        rooms[roomCode].players[socket.id] = {
            id: socket.id,
            username: username || 'Host Student',
            isHost: true, hp: 100, x: 0, y: 1.6, z: 4, yaw: 0, pitch: 0, color: '#3b82f6', isSpectator: false
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode, playerId: socket.id, settings: rooms[roomCode].settings });
        io.to(roomCode).emit('lobby_update', rooms[roomCode]);
    });

    socket.on('join_room', ({ roomCode, username }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('error_msg', 'Room code does not exist!');

        const colors = ['#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
        const pColor = colors[Object.keys(room.players).length % colors.length];
        const isSpec = room.started; // Join as spectator if match already started

        currentRoom = roomCode;
        const newPlayer = {
            id: socket.id,
            username: username || `Student_${Math.floor(Math.random() * 1000)}`,
            isHost: false, hp: 100, x: 0, y: 1.6, z: 4, yaw: 0, pitch: 0, color: pColor, isSpectator: isSpec
        };
        room.players[socket.id] = newPlayer;

        socket.join(roomCode);
        
        // Let the joiner know their state
        socket.emit('room_joined', { roomCode, playerId: socket.id, settings: room.settings, isSpectator: isSpec, players: room.players });
        
        if (isSpec) {
            // Tell existing players someone joined as a spectator
            socket.to(roomCode).emit('spectator_joined', newPlayer.username);
            // Send peer update so clients know they exist
            socket.to(roomCode).emit('peer_update', newPlayer);
        } else {
            io.to(roomCode).emit('lobby_update', room);
        }
    });

    socket.on('start_game', () => {
        const room = rooms[currentRoom];
        if (room && room.hostId === socket.id) {
            room.started = true;
            Object.values(room.players).forEach((player) => {
                player.hp = 100;
                player.isSpectator = false; // Everyone plays in the new round
            });
            io.to(currentRoom).emit('match_started', { players: room.players, settings: room.settings });
        }
    });

    socket.on('player_update', (data) => {
        const room = rooms[currentRoom];
        if (room && room.players[socket.id]) {
            Object.assign(room.players[socket.id], data);
            socket.to(currentRoom).emit('peer_update', { id: socket.id, ...data });
        }
    });

    socket.on('player_attack', (data) => { socket.to(currentRoom).emit('peer_attack', { attackerId: socket.id, ...data }); });
    socket.on('player_hit', ({ targetId, damage }) => {
        const room = rooms[currentRoom];
        if (room && room.players[targetId] && !room.players[targetId].isSpectator) {
            room.players[targetId].hp = Math.max(0, room.players[targetId].hp - damage);
            io.to(currentRoom).emit('player_damaged', { targetId, hp: room.players[targetId].hp, damage });
        }
    });

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
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
