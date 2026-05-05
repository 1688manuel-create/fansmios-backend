// backend/sockets/liveSocket.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const pushService = require('../utils/pushService'); 

if (!global.liveGuests) global.liveGuests = {};
if (!global.liveBattles) global.liveBattles = {};
if (!global.slowMode) global.slowMode = {};

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log(`⚡ Nueva conexión en Tiempo Real: ${socket.id}`);

    socket.on('joinLiveStream', async ({ streamId, userId, isGhost, isCreator }) => {
      socket.join(streamId);
      socket.data = { streamId, userId, isGhost: isGhost || false, isCreator: isCreator || false, lastMessageTime: 0 };
      
      try {
        if (userId) {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          if (user?.role === 'ADMIN') socket.data.isGhost = true; 

          if (isCreator && !socket.data.isGhost) {
            pushService.notifyFollowers(userId, `¡${user?.username || 'Alguien'} ESTÁ EN VIVO! 🔥`, "Entra ahora para ver el show.", `/live/${streamId}`);
          }
          if (!socket.data.isGhost) {
            socket.to(streamId).emit('userJoined', { username: user?.username });
          }
        }
        updateViewerCount(io, streamId);

        if (global.liveBattles[streamId]) socket.emit('battle:update', global.liveBattles[streamId]);
        if (global.slowMode[streamId]) socket.emit('slowmode:update', global.slowMode[streamId]);

      } catch (error) { console.error("Error al unir usuario al live:", error); }
    });

    socket.on('guest:invite', ({ streamId, userId }) => {
      if (!global.liveGuests[streamId]) global.liveGuests[streamId] = [];
      if (global.liveGuests[streamId].length >= 4) return; 
      if (!global.liveGuests[streamId].includes(userId)) global.liveGuests[streamId].push(userId);
      io.to(streamId).emit('guests:update', global.liveGuests[streamId]);
    });

    // ==========================================
    // ⚔️ FASE 2: BATALLAS DE CASTIGO (TIMER Y EQUIPOS)
    // ==========================================
    socket.on('battle:start', ({ streamId, leftName, rightName, durationMinutes }) => {
      console.log(`⚔️ Batalla iniciada en ${streamId}: ${leftName} vs ${rightName}`);
      const endTime = Date.now() + (durationMinutes * 60 * 1000); // Calculamos el futuro en milisegundos

      global.liveBattles[streamId] = {
        active: true,
        leftName: leftName || 'Opción A',
        rightName: rightName || 'Opción B',
        leftScore: 0,
        rightScore: 0,
        endTime: endTime // Guardamos cuándo termina
      };
      io.to(streamId).emit('battle:update', global.liveBattles[streamId]);
    });

    socket.on('slowmode:set', ({ streamId, seconds }) => {
      global.slowMode[streamId] = seconds;
      io.to(streamId).emit('slowmode:update', seconds);
    });

    // 🔥 PROCESADOR CENTRAL (CHAT Y DONACIONES EN USD)
    socket.on('broadcastMessage', async (messageData) => {
      const { streamId, senderId, amount: amountUsd, isDonation, text, isLike, battleSide } = messageData;

      if (isLike) return io.to(streamId).emit('newLiveMessage', messageData);

      if (!isDonation) {
        const slowMode = global.slowMode[streamId] || 0;
        const now = Date.now();
        if (slowMode > 0 && now - socket.data.lastMessageTime < slowMode * 1000) return;
        socket.data.lastMessageTime = now;
      }

      try {
        if (isDonation && amountUsd > 0) {
          const giftResult = await prisma.$transaction(async (tx) => {
            const senderWallet = await tx.wallet.findUnique({ where: { userId: senderId } });
            if (!senderWallet || senderWallet.balance < amountUsd) throw new Error("SALDO_INSUFICIENTE");

            const stream = await tx.liveStream.findUnique({ where: { id: streamId }, select: { creatorId: true, creator: { select: { creatorProfile: true } } } });
            if (!stream) throw new Error("STREAM_NO_ENCONTRADO");

            const globalSettings = await tx.platformSetting.findFirst() || { feeTips: 20 };
            let feePercent = globalSettings.feeTips / 100;
            if (stream.creator?.creatorProfile?.customFeeTips != null) feePercent = stream.creator.creatorProfile.customFeeTips / 100;

            const fee = amountUsd * feePercent; 
            const netAmount = amountUsd - fee; 

            await tx.wallet.update({ where: { userId: senderId }, data: { balance: { decrement: amountUsd } } });
            await tx.wallet.update({ where: { userId: stream.creatorId }, data: { balance: { increment: netAmount } } });

            await tx.transaction.create({
              data: {
                senderId, receiverId: stream.creatorId, amount: amountUsd, platformFee: fee, netAmount: netAmount, type: 'TIP', status: 'COMPLETED',
                attachedMessage: `Regalo en Vivo: ${text || 'Animación'} ($${amountUsd.toFixed(2)} USD)` 
              }
            });
            return { success: true, amountUsd };
          });

          socket.to(streamId).emit('updateLiveGoal', { amount: giftResult.amountUsd });

          // ⚔️ FASE 2: SUMAR AL EQUIPO CORRECTO EN LA BATALLA
          if (global.liveBattles[streamId] && global.liveBattles[streamId].active) {
            // Solo suma si la batalla no ha terminado
            if (Date.now() < global.liveBattles[streamId].endTime) {
              if (battleSide === 'right') {
                global.liveBattles[streamId].rightScore += giftResult.amountUsd;
              } else {
                global.liveBattles[streamId].leftScore += giftResult.amountUsd;
              }
              io.to(streamId).emit('battle:update', global.liveBattles[streamId]);
            }
          }
        }
        io.to(streamId).emit('newLiveMessage', messageData);

      } catch (error) {
        if (error.message === "SALDO_INSUFICIENTE") socket.emit('error', { message: "No tienes suficiente saldo en tu bóveda." });
        else console.error("Error crítico en broadcastMessage:", error);
      }
    });

    socket.on('streamEnded', ({ streamId }) => {
      delete global.liveBattles[streamId];
      delete global.liveGuests[streamId];
      delete global.slowMode[streamId];
      socket.to(streamId).emit('streamKilled');
    });

    socket.on('activatePaywall', async ({ streamId, price }) => {
      try { await prisma.liveStream.update({ where: { id: streamId }, data: { isPPV: true, price: parseFloat(price) } });
      } catch (error) {}
      socket.to(streamId).emit('paywallActivated', { price });
    });

    socket.on('disconnect', () => { if (socket.data.streamId) updateViewerCount(io, socket.data.streamId); });
  });
};

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