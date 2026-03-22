// backend/sockets/liveSocket.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log(`⚡ Nueva conexión en Tiempo Real: ${socket.id}`);

    // ==========================================
    // 1. UNIRSE A LA TRANSMISIÓN (SALA), MODO FANTASMA Y CONTADOR
    // ==========================================
    // Recibimos isGhost desde el Frontend
    socket.on('joinLiveStream', async ({ streamId, userId, isGhost }) => {
      socket.join(streamId);
      
      // Guardamos en la memoria temporal del socket en qué sala está y si es FANTASMA
      socket.data.streamId = streamId; 
      socket.data.isGhost = isGhost || false; 
      
      try {
        if (userId) {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          
          // 👻 Si es ADMIN o viene marcado como Fantasma, entra en absoluto secreto
          if (isGhost || user?.role === 'ADMIN') {
            console.log(`👻 ADMIN/FANTASMA entró en secreto al Live: ${streamId}`);
          } else {
            console.log(`👤 Usuario ${user?.username} entró al Live: ${streamId}`);
            // Avisamos a la sala que alguien normal entró
            socket.to(streamId).emit('userJoined', { username: user?.username });
          }
        }
        
        // 📊 Calculamos los espectadores REALES (Ignorando a los Fantasmas)
        const room = io.sockets.adapter.rooms.get(streamId);
        let viewersCount = 0;
        
        if (room) {
          for (const socketId of room) {
            const clientSocket = io.sockets.sockets.get(socketId);
            // Sumamos solo si el usuario NO es un fantasma
            if (clientSocket && !clientSocket.data.isGhost) {
              viewersCount++;
            }
          }
        }
        
        // 📢 Disparamos el nuevo contador filtrado a TODOS en la sala
        io.to(streamId).emit('viewerCountUpdated', { count: viewersCount });

      } catch (error) {
        console.error("Error al unir usuario al live:", error);
      }
    });

    // ==========================================
    // 🔥 2. EL REPETIDOR DE SEÑAL (Mensajes y Lluvia de Propinas)
    // ==========================================
    socket.on('broadcastMessage', (messageData) => {
      // Monitor de consola para el servidor
      if (messageData.isDonation) {
        console.log(`💸 [SUPER CHAT] Lluvia de $${messageData.amount} USD en sala ${messageData.streamId}`);
      }

      // Disparamos la lluvia de dinero / mensaje a todos los demás
      socket.to(messageData.streamId).emit('newLiveMessage', messageData);
    });

    // ==========================================
    // 🛑 3. KILL SWITCH (Finalizar Stream)
    // ==========================================
    socket.on('streamEnded', ({ streamId }) => {
      console.log(`🛑 El Creador ha finalizado el Stream: ${streamId}`);
      socket.to(streamId).emit('streamKilled');
    });

    // ==========================================
    // 🔌 4. DESCONEXIÓN AUTOMÁTICA
    // ==========================================
    socket.on('disconnect', () => {
      console.log(`🔌 Usuario desconectado: ${socket.id}`);
      
      // Si el usuario estaba viendo un Live, recalculamos la sala
      if (socket.data.streamId) {
        const streamId = socket.data.streamId;
        const room = io.sockets.adapter.rooms.get(streamId);
        let viewersCount = 0;
        
        // Volvemos a contar ignorando a los fantasmas restantes
        if (room) {
          for (const socketId of room) {
            const clientSocket = io.sockets.sockets.get(socketId);
            if (clientSocket && !clientSocket.data.isGhost) {
              viewersCount++;
            }
          }
        }
        
        // Actualizamos el número en la pantalla
        io.to(streamId).emit('viewerCountUpdated', { count: viewersCount });
      }
    });
    
  });
};