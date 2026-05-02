// backend/sockets/liveSocket.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const pushService = require('../utils/pushService'); // <--- IMPORTANTE

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log(`⚡ Nueva conexión en Tiempo Real: ${socket.id}`);

    // ==========================================
    // 1. UNIRSE A LA TRANSMISIÓN (SALA), MODO FANTASMA Y CONTADOR
    // ==========================================
    socket.on('joinLiveStream', async ({ streamId, userId, isGhost, isCreator }) => {
      socket.join(streamId);
      
      socket.data.streamId = streamId; 
      socket.data.isGhost = isGhost || false; 
      
      try {
        if (userId) {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          
          if (user?.role === 'ADMIN') {
            socket.data.isGhost = true; 
          }

          if (isCreator && !socket.data.isGhost) {
            console.log(`📢 Creador detectado. Iniciando ráfaga de notificaciones para ${user?.username}...`);
            
            pushService.notifyFollowers(
              userId, 
              `¡${user?.username || 'Alguien'} ESTÁ EN VIVO! 🔥`, 
              "Entra ahora para ver el show exclusivo en FansMio.",
              `/live/${streamId}`
            );
          }
          
          if (socket.data.isGhost) {
            console.log(`👻 ADMIN/FANTASMA entró en secreto al Live: ${streamId}`);
          } else {
            console.log(`👤 Usuario ${user?.username} entró al Live: ${streamId}`);
            socket.to(streamId).emit('userJoined', { username: user?.username });
          }
        }
        
        const room = io.sockets.adapter.rooms.get(streamId);
        let viewersCount = 0;
        
        if (room) {
          for (const socketId of room) {
            const clientSocket = io.sockets.sockets.get(socketId);
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
    // 🔥 2. PROCESADOR DE REGALOS (100% DÓLARES / USD)
    // ==========================================
    socket.on('broadcastMessage', async (messageData) => {
      // El frontend ahora manda la cantidad exacta en DÓLARES en el campo 'amount'
      const { streamId, senderId, amount: amountUsd, isDonation, text } = messageData;

      try {
        if (isDonation && amountUsd > 0) {
          console.log(`💵 Procesando Regalo de $${amountUsd} USD...`);

          // 🛡️ TRANSACCIÓN ATÓMICA DE GRADO INDUSTRIAL
          const giftResult = await prisma.$transaction(async (tx) => {
            
            // 1. Buscamos la billetera del fan
            const senderWallet = await tx.wallet.findUnique({
              where: { userId: senderId }
            });

            // 🛑 EL FILTRO: Verificamos el saldo en DÓLARES (balance)
            if (!senderWallet || senderWallet.balance < amountUsd) {
              throw new Error("SALDO_INSUFICIENTE");
            }

            // 2. Buscamos quién es el creador
            const stream = await tx.liveStream.findUnique({
              where: { id: streamId },
              select: { creatorId: true }
            });

            if (!stream) throw new Error("STREAM_NO_ENCONTRADO");

            // 💰 3. PURA MATEMÁTICA FINANCIERA (Sin conversiones)
            const fee = amountUsd * 0.20; // 20% para la plataforma
            const netAmount = amountUsd - fee; // Lo que se lleva el creador

            // 4A. RESTAMOS DÓLARES al fan
            await tx.wallet.update({
              where: { userId: senderId },
              data: { balance: { decrement: amountUsd } }
            });

            // 4B. SUMAMOS DÓLARES al creador
            await tx.wallet.update({
              where: { userId: stream.creatorId },
              data: { balance: { increment: netAmount } }
            });

            // 5. REGISTRAMOS LA TRANSACCIÓN LEGALMENTE
            await tx.transaction.create({
              data: {
                senderId,
                receiverId: stream.creatorId,
                amount: amountUsd,      // Registramos el valor exacto en USD
                platformFee: fee,       // Tu comisión en USD
                netAmount: netAmount,   // Ganancia neta del creador en USD
                type: 'TIP',            // En tu Enum es TIP (Propina)
                status: 'COMPLETED',
                attachedMessage: `Regalo en Vivo: ${text || 'Animación'} ($${amountUsd.toFixed(2)} USD)` 
              }
            });

            return { success: true, amountUsd };
          });

          // Si todo salió bien, actualizamos la barra de meta en dólares
          console.log(`💸 Lluvia exitosa. $${giftResult.amountUsd} USD procesados en sala ${streamId}`);
          socket.to(streamId).emit('updateLiveGoal', { amount: giftResult.amountUsd });
        }

        // Emitimos la animación a toda la sala
        io.to(streamId).emit('newLiveMessage', messageData);

      } catch (error) {
        if (error.message === "SALDO_INSUFICIENTE") {
          console.log(`❌ Intento de fraude: Usuario ${senderId} no tiene suficiente saldo USD.`);
          socket.emit('error', { message: "No tienes suficiente saldo en tu bóveda. ¡Recarga ahora! 💵" });
        } else {
          console.error("Error crítico en broadcastMessage:", error);
        }
      }
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
      console.log(`🔒 El Creador bloqueó la sala ${streamId}. Nuevo Precio: $${price} USD`);
      
      try {
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

      socket.to(streamId).emit('paywallActivated', { price });
    });

    // ==========================================
    // 🔌 5. DESCONEXIÓN AUTOMÁTICA
    // ==========================================
    socket.on('disconnect', () => {
      console.log(`🔌 Usuario desconectado: ${socket.id}`);
      
      if (socket.data.streamId) {
        const streamId = socket.data.streamId;
        const room = io.sockets.adapter.rooms.get(streamId);
        let viewersCount = 0;
        
        if (room) {
          for (const socketId of room) {
            const clientSocket = io.sockets.sockets.get(socketId);
            if (clientSocket && !clientSocket.data.isGhost) {
              viewersCount++;
            }
          }
        }
        
        io.to(streamId).emit('viewerCountUpdated', { count: viewersCount });
      }
    });
    
  });
};