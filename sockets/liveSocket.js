// backend/sockets/liveSocket.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log(`⚡ Nueva conexión en Tiempo Real: ${socket.id}`);

    // ==========================================
    // 1. UNIRSE A LA TRANSMISIÓN (SALA), MODO FANTASMA Y CONTADOR
    // ==========================================
    socket.on('joinLiveStream', async ({ streamId, userId, isGhost }) => {
      socket.join(streamId);
      
      // Guardamos el estado inicial que manda el frontend
      socket.data.streamId = streamId; 
      socket.data.isGhost = isGhost || false; 
      
      try {
        if (userId) {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          
          // 🔥 BLINDAJE ABSOLUTO: Si es ADMIN, forzamos el modo fantasma desde el servidor
          if (user?.role === 'ADMIN') {
            socket.data.isGhost = true; 
          }
          
          // Ahora usamos socket.data.isGhost que ya está blindado
          if (socket.data.isGhost) {
            console.log(`👻 ADMIN/FANTASMA entró en secreto al Live: ${streamId}`);
          } else {
            console.log(`👤 Usuario ${user?.username} entró al Live: ${streamId}`);
            socket.to(streamId).emit('userJoined', { username: user?.username });
          }
        }
        
        // 📊 Calculamos los espectadores REALES
        const room = io.sockets.adapter.rooms.get(streamId);
        let viewersCount = 0;
        
        if (room) {
          for (const socketId of room) {
            const clientSocket = io.sockets.sockets.get(socketId);
            // El Admin no se sumará porque forzamos su isGhost a true arriba
            if (clientSocket && !clientSocket.data.isGhost) {
              viewersCount++;
            }
          }
        }
        
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
        
        // 🎯 CIRUGÍA APLICADA AQUÍ: Avisamos a los demás para subir la barra de Meta
        socket.to(messageData.streamId).emit('updateLiveGoal', { amount: messageData.amount });
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
    // 🛡️ 4. SALTO VIP (BLOQUEAR SALA EN VIVO PERMANENTEMENTE)
    // ==========================================
    socket.on('activatePaywall', async ({ streamId, price }) => {
      console.log(`🔒 El Creador bloqueó la sala ${streamId}. Nuevo Precio: $${price}`);
      
      try {
        // 🔥 EL BLINDAJE: Guardamos el candado en la Base de Datos. 
        // Si alguien recarga la página, el servidor sabrá que ya es de pago.
        await prisma.liveStream.update({
          where: { id: streamId },
          data: { 
            isPPV: true, 
            price: parseFloat(price) 
          }
        });
      } catch (error) {
        console.error("Error sellando la puerta en la Base de Datos:", error);
      }

      // Le mandamos la alerta roja a todos los fans conectados para expulsarlos
      socket.to(streamId).emit('paywallActivated', { price });
    });

    // ==========================================
    // 🔌 5. DESCONEXIÓN AUTOMÁTICA
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