// backend/sockets/liveSocket.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log(`⚡ Nueva conexión en Tiempo Real: ${socket.id}`);

    // ==========================================
    // 1. UNIRSE A LA TRANSMISIÓN (SALA), MODO FANTASMA Y CONTADOR
    // ==========================================
    socket.on('joinLiveStream', async ({ streamId, userId }) => {
      socket.join(streamId);
      
      // Guardamos en la memoria temporal del socket en qué sala está, para cuando se desconecte
      socket.data.streamId = streamId; 
      
      try {
        // 📊 Calculamos los espectadores reales conectados a esta sala
        const viewersCount = io.sockets.adapter.rooms.get(streamId)?.size || 0;

        if (userId) {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          
          // 👻 Si es ADMIN, entra en secreto (no avisamos al chat)
          if (user?.role === 'ADMIN') {
            console.log(`👻 ADMIN entró en secreto al Live: ${streamId}`);
          } else {
            console.log(`👤 Usuario ${user?.username} entró al Live: ${streamId}`);
            // Avisamos a la sala que alguien normal entró
            socket.to(streamId).emit('userJoined', { username: user?.username });
          }
        }
        
        // 📢 Disparamos el nuevo contador de espectadores a TODOS en la sala
        io.to(streamId).emit('viewerCountUpdated', { count: viewersCount });

      } catch (error) {
        console.error("Error al unir usuario al live:", error);
      }
    });

    // ==========================================
    // 🔥 2. EL REPETIDOR DE SEÑAL (Mensajes y Lluvia de Propinas)
    // ==========================================
    // El Frontend llama a la API, la API cobra, y luego el Frontend le pasa el mensaje ya pagado a este Socket
    socket.on('broadcastMessage', (messageData) => {
      
      // Monitor de consola para el servidor
      if (messageData.isDonation) {
        console.log(`💸 [SUPER CHAT] Lluvia de $${messageData.amount} USD en sala ${messageData.streamId}`);
      }

      // Disparamos la lluvia de dinero / mensaje a todos los demás en menos de 50ms
      socket.to(messageData.streamId).emit('newLiveMessage', messageData);
    });

    // ==========================================
    // 🛑 3. KILL SWITCH (Finalizar Stream)
    // ==========================================
    // Cuando el creador aprieta "Terminar", avisamos a los fans para que se cierre su video
    socket.on('streamEnded', ({ streamId }) => {
      console.log(`🛑 El Creador ha finalizado el Stream: ${streamId}`);
      socket.to(streamId).emit('streamKilled');
    });

    // ==========================================
    // 🔌 4. DESCONEXIÓN AUTOMÁTICA
    // ==========================================
    socket.on('disconnect', () => {
      console.log(`🔌 Usuario desconectado: ${socket.id}`);
      
      // Si el usuario estaba viendo un Live, le restamos 1 al contador
      if (socket.data.streamId) {
        const streamId = socket.data.streamId;
        const viewersCount = io.sockets.adapter.rooms.get(streamId)?.size || 0;
        
        // Actualizamos el número en la pantalla de los que se quedaron
        io.to(streamId).emit('viewerCountUpdated', { count: viewersCount });
      }
    });
    
  });
};