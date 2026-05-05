// backend/sockets/liveSocket.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const pushService = require('../utils/pushService'); 

// 🔥 ESTADOS GLOBALES EN MEMORIA (Rapidez extrema sin saturar la Base de Datos)
if (!global.liveGuests) global.liveGuests = {};
if (!global.liveBattles) global.liveBattles = {};
if (!global.slowMode) global.slowMode = {};

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log(`⚡ Nueva conexión en Tiempo Real: ${socket.id}`);

    // ==========================================
    // 1. UNIRSE A LA TRANSMISIÓN (SALA) Y MODO FANTASMA
    // ==========================================
    socket.on('joinLiveStream', async ({ streamId, userId, isGhost, isCreator }) => {
      socket.join(streamId);
      
      socket.data = {
        streamId,
        userId,
        isGhost: isGhost || false,
        isCreator: isCreator || false,
        lastMessageTime: 0 // Para el modo lento
      };
      
      try {
        if (userId) {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          
          if (user?.role === 'ADMIN') socket.data.isGhost = true; 

          // Notificaciones Push si es el Creador
          if (isCreator && !socket.data.isGhost) {
            console.log(`📢 Creador detectado. Iniciando ráfaga de notificaciones para ${user?.username}...`);
            pushService.notifyFollowers(
              userId, 
              `¡${user?.username || 'Alguien'} ESTÁ EN VIVO! 🔥`, 
              "Entra ahora para ver el show exclusivo en FansMio.",
              `/live/${streamId}`
            );
          }
          
          if (!socket.data.isGhost) {
            console.log(`👤 Usuario ${user?.username} entró al Live: ${streamId}`);
            socket.to(streamId).emit('userJoined', { username: user?.username });
          }
        }
        
        updateViewerCount(io, streamId);

        // 🔄 SINCRONIZAR AL NUEVO USUARIO CON EL ESTADO ACTUAL DE LA SALA
        if (global.liveBattles[streamId]) {
          socket.emit('battle:update', global.liveBattles[streamId]);
        }
        if (global.slowMode[streamId]) {
          socket.emit('slowmode:update', global.slowMode[streamId]);
        }

      } catch (error) {
        console.error("Error al unir usuario al live:", error);
      }
    });

    // ==========================================
    // 👥 2. SISTEMA MULTI-INVITADOS
    // ==========================================
    socket.on('guest:invite', ({ streamId, userId }) => {
      if (!global.liveGuests[streamId]) global.liveGuests[streamId] = [];
      if (global.liveGuests[streamId].length >= 4) return; // Límite de 4
      
      if (!global.liveGuests[streamId].includes(userId)) {
        global.liveGuests[streamId].push(userId);
      }
      io.to(streamId).emit('guests:update', global.liveGuests[streamId]);
    });

    // ==========================================
    // ⚔️ 3. SISTEMA DE BATALLAS ÉPICAS
    // ==========================================
    socket.on('battle:start', ({ streamId, rivalId }) => {
      console.log(`⚔️ Batalla iniciada en ${streamId} contra ${rivalId}`);
      global.liveBattles[streamId] = {
        active: true,
        leftScore: 0,
        rightScore: 0,
        rivalId
      };
      io.to(streamId).emit('battle:update', global.liveBattles[streamId]);
    });

    // ==========================================
    // 🐢 4. MODO LENTO (ANTI-SPAM)
    // ==========================================
    socket.on('slowmode:set', ({ streamId, seconds }) => {
      console.log(`🐢 Modo lento ajustado a ${seconds}s en ${streamId}`);
      global.slowMode[streamId] = seconds;
      io.to(streamId).emit('slowmode:update', seconds);
    });

    // ==========================================
    // 🔥 5. PROCESADOR CENTRAL (CHAT Y DONACIONES EN USD) - BLINDADO 🛡️
    // ==========================================
    socket.on('broadcastMessage', async (messageData) => {
      const { streamId, senderId, amount: amountUsd, isDonation, text, isLike } = messageData;

      // 5.1 Lógica rápida para Likes (No bloquea la BD)
      if (isLike) {
        return io.to(streamId).emit('newLiveMessage', messageData);
      }

      // 5.2 Control de Spam (Modo Lento) solo para chat de texto normal
      if (!isDonation) {
        const slowMode = global.slowMode[streamId] || 0;
        const now = Date.now();
        if (slowMode > 0 && now - socket.data.lastMessageTime < slowMode * 1000) {
          return; // Ignoramos el mensaje si está enviando muy rápido
        }
        socket.data.lastMessageTime = now;
      }

      try {
        // 5.3 PROCESAMIENTO FINANCIERO ATÓMICO (La joya de la corona)
        if (isDonation && amountUsd > 0) {
          console.log(`💵 Procesando Regalo de $${amountUsd} USD...`);

          const giftResult = await prisma.$transaction(async (tx) => {
            const senderWallet = await tx.wallet.findUnique({ where: { userId: senderId } });

            if (!senderWallet || senderWallet.balance < amountUsd) {
              throw new Error("SALDO_INSUFICIENTE");
            }

            const stream = await tx.liveStream.findUnique({
              where: { id: streamId },
              select: { creatorId: true, creator: { select: { creatorProfile: true } } }
            });

            if (!stream) throw new Error("STREAM_NO_ENCONTRADO");

            // COMISIONES VIP
            const globalSettings = await tx.platformSetting.findFirst() || { feeTips: 20 };
            let feePercent = globalSettings.feeTips / 100;
            
            const creatorProfile = stream.creator?.creatorProfile;
            if (creatorProfile && creatorProfile.customFeeTips !== null && creatorProfile.customFeeTips !== undefined) {
              feePercent = creatorProfile.customFeeTips / 100;
            }

            const fee = amountUsd * feePercent; 
            const netAmount = amountUsd - fee; 

            // MOVIMIENTO DE DINERO
            await tx.wallet.update({ where: { userId: senderId }, data: { balance: { decrement: amountUsd } } });
            await tx.wallet.update({ where: { userId: stream.creatorId }, data: { balance: { increment: netAmount } } });

            // REGISTRO LEGAL
            await tx.transaction.create({
              data: {
                senderId, receiverId: stream.creatorId,
                amount: amountUsd, platformFee: fee, netAmount: netAmount,
                type: 'TIP', status: 'COMPLETED',
                attachedMessage: `Regalo en Vivo: ${text || 'Animación'} ($${amountUsd.toFixed(2)} USD)` 
              }
            });

            return { success: true, amountUsd };
          });

          console.log(`💸 $${giftResult.amountUsd} USD procesados en sala ${streamId}`);
          
          // ACTUALIZAR META
          socket.to(streamId).emit('updateLiveGoal', { amount: giftResult.amountUsd });

          // ⚔️ ACTUALIZAR BATALLA (Si hay una activa)
          if (global.liveBattles[streamId] && global.liveBattles[streamId].active) {
            global.liveBattles[streamId].leftScore += giftResult.amountUsd;
            io.to(streamId).emit('battle:update', global.liveBattles[streamId]);
          }
        }

        // Emitimos el mensaje o regalo al chat
        io.to(streamId).emit('newLiveMessage', messageData);

      } catch (error) {
        if (error.message === "SALDO_INSUFICIENTE") {
          console.log(`❌ Intento de fraude: Usuario ${senderId} no tiene suficiente saldo USD.`);
          socket.emit('error', { message: "No tienes suficiente saldo en tu bóveda." });
        } else {
          console.error("Error crítico en broadcastMessage:", error);
        }
      }
    });

    // ==========================================
    // 🛑 6. KILL SWITCH (Finalizar Stream)
    // ==========================================
    socket.on('streamEnded', ({ streamId }) => {
      console.log(`🛑 El Creador ha finalizado el Stream: ${streamId}`);
      // Limpiamos la memoria
      delete global.liveBattles[streamId];
      delete global.liveGuests[streamId];
      delete global.slowMode[streamId];
      socket.to(streamId).emit('streamKilled');
    });

    // ==========================================
    // 🛡️ 7. SALTO VIP (PAYWALL EN VIVO)
    // ==========================================
    socket.on('activatePaywall', async ({ streamId, price }) => {
      console.log(`🔒 El Creador bloqueó la sala ${streamId}. Nuevo Precio: $${price} USD`);
      try {
        await prisma.liveStream.update({
          where: { id: streamId },
          data: { isPPV: true, price: parseFloat(price) }
        });
      } catch (error) {
        console.error("Error sellando la puerta en la Base de Datos:", error);
      }
      socket.to(streamId).emit('paywallActivated', { price });
    });

    // ==========================================
    // 🔌 8. DESCONEXIÓN AUTOMÁTICA
    // ==========================================
    socket.on('disconnect', () => {
      console.log(`🔌 Usuario desconectado: ${socket.id}`);
      if (socket.data.streamId) {
        updateViewerCount(io, socket.data.streamId);
      }
    });
    
  });
};

/* =========================================================
👁️ CONTADOR DE ESPECTADORES REALES (Sin fantasmas)
========================================================= */
function updateViewerCount(io, streamId) {
  const room = io.sockets.adapter.rooms.get(streamId);
  let count = 0;

  if (room) {
    for (const id of room) {
      const s = io.sockets.sockets.get(id);
      if (s && !s.data.isGhost) count++;
    }
  }
  io.to(streamId).emit('viewerCountUpdated', { count });
}