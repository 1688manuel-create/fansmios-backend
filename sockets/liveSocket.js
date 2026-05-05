// backend/sockets/liveSocket.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const pushService = require('../utils/pushService'); 

if (!global.liveGuests) global.liveGuests = {};
if (!global.liveBattles) global.liveBattles = {};
if (!global.slowMode) global.slowMode = {};
// 🔥 FASE 4: ESTADO GLOBAL PARA SUBASTAS
if (!global.liveAuctions) global.liveAuctions = {};

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

        // SINCRONIZACIÓN DE ESTADOS AL ENTRAR
        if (global.liveBattles[streamId]) socket.emit('battle:update', global.liveBattles[streamId]);
        if (global.slowMode[streamId]) socket.emit('slowmode:update', global.slowMode[streamId]);
        if (global.liveAuctions[streamId]) socket.emit('auction:update', global.liveAuctions[streamId]);

      } catch (error) { console.error("Error al unir usuario al live:", error); }
    });

    socket.on('guest:invite', ({ streamId, userId }) => {
      if (!global.liveGuests[streamId]) global.liveGuests[streamId] = [];
      if (global.liveGuests[streamId].length >= 4) return; 
      if (!global.liveGuests[streamId].includes(userId)) global.liveGuests[streamId].push(userId);
      io.to(streamId).emit('guests:update', global.liveGuests[streamId]);
    });

    socket.on('battle:start', ({ streamId, leftName, rightName, durationMinutes }) => {
      console.log(`⚔️ Batalla iniciada en ${streamId}`);
      global.liveBattles[streamId] = { active: true, leftName: leftName || 'Opción A', rightName: rightName || 'Opción B', leftScore: 0, rightScore: 0, endTime: Date.now() + (durationMinutes * 60 * 1000) };
      io.to(streamId).emit('battle:update', global.liveBattles[streamId]);
    });

    socket.on('slowmode:set', ({ streamId, seconds }) => {
      global.slowMode[streamId] = seconds;
      io.to(streamId).emit('slowmode:update', seconds);
    });

    // ==========================================
    // 🔨 FASE 4: MOTOR DE SUBASTAS
    // ==========================================
    socket.on('auction:start', ({ streamId, item, startingPrice, durationMinutes }) => {
      console.log(`🔨 Subasta iniciada en ${streamId} por ${item}`);
      global.liveAuctions[streamId] = {
        active: true,
        item: item,
        currentBid: parseFloat(startingPrice),
        highestBidderId: null,
        highestBidderName: null,
        creatorId: null, // Se llena en la primera puja
        feePercent: 0,   // Se llena en la primera puja
        endTime: Date.now() + (durationMinutes * 60 * 1000)
      };
      io.to(streamId).emit('auction:update', global.liveAuctions[streamId]);
    });

    socket.on('auction:bid', async ({ streamId, senderId, amount, senderName }) => {
      try {
        const auction = global.liveAuctions[streamId];
        if (!auction || !auction.active || Date.now() > auction.endTime) {
          return socket.emit('error', { message: 'La subasta no está activa o ya finalizó.' });
        }
        if (amount <= auction.currentBid && auction.highestBidderId !== null) {
          return socket.emit('error', { message: 'Tu puja debe ser mayor a la actual.' });
        }

        console.log(`🔨 Procesando puja de $${amount} de ${senderName}`);

        await prisma.$transaction(async (tx) => {
          const senderWallet = await tx.wallet.findUnique({ where: { userId: senderId } });
          if (!senderWallet || senderWallet.balance < amount) throw new Error("SALDO_INSUFICIENTE");

          const stream = await tx.liveStream.findUnique({ where: { id: streamId }, select: { creatorId: true, creator: { select: { creatorProfile: true } } } });
          
          // Calcular comisiones actuales
          const globalSettings = await tx.platformSetting.findFirst() || { feeTips: 20 };
          let feePercent = globalSettings.feeTips / 100;
          if (stream.creator?.creatorProfile?.customFeeTips != null) feePercent = stream.creator.creatorProfile.customFeeTips / 100;

          // 🔄 DEVOLUCIÓN INSTANTÁNEA AL POSTOR ANTERIOR
          if (auction.highestBidderId) {
            // Devolver dinero al fan anterior
            await tx.wallet.update({ where: { userId: auction.highestBidderId }, data: { balance: { increment: auction.currentBid } } });
            
            // Retirar el dinero provisional que le dimos al creador por la puja anterior
            const oldNetAmount = auction.currentBid - (auction.currentBid * auction.feePercent);
            await tx.wallet.update({ where: { userId: auction.creatorId }, data: { balance: { decrement: oldNetAmount } } });
          }

          // 💰 COBRAR AL NUEVO POSTOR
          const newFee = amount * feePercent;
          const newNetAmount = amount - newFee;

          await tx.wallet.update({ where: { userId: senderId }, data: { balance: { decrement: amount } } });
          await tx.wallet.update({ where: { userId: stream.creatorId }, data: { balance: { increment: newNetAmount } } });

          // Registrar en memoria
          auction.currentBid = amount;
          auction.highestBidderId = senderId;
          auction.highestBidderName = senderName;
          auction.creatorId = stream.creatorId;
          auction.feePercent = feePercent;

          // Registrar transacción legal
          await tx.transaction.create({
            data: {
              senderId, receiverId: stream.creatorId, amount, platformFee: newFee, netAmount: newNetAmount, type: 'TIP', status: 'COMPLETED',
              attachedMessage: `🔨 Ganador provisional de Subasta: ${auction.item}`
            }
          });
          return true;
        });

        io.to(streamId).emit('auction:update', auction);
        io.to(streamId).emit('newLiveMessage', {
          content: `🔨 ¡${senderName} lidera la subasta con $${amount.toFixed(2)} USD!`,
          isDonation: true, amount: amount, isSystem: true, id: Date.now().toString()
        });

      } catch (error) {
        if (error.message === "SALDO_INSUFICIENTE") socket.emit('error', { message: "No tienes suficiente saldo." });
        else console.error("Error en subasta:", error);
      }
    });

    const ROULETTE_OPTIONS = ["Beso a la cámara 💋", "Baile sexy (15s) 💃", "Quitar una prenda 🔥", "Gritar tu nombre 🗣️", "Mostrar un juguete 🧸", "ASMR al oído (20s) 🎧", "Pose provocativa 📸", "Verdad o Reto 😈"];

    socket.on('spinRoulette', async (messageData) => {
      const { streamId, senderId, amount: amountUsd, battleSide } = messageData;
      try {
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
            data: { senderId, receiverId: stream.creatorId, amount: amountUsd, platformFee: fee, netAmount: netAmount, type: 'TIP', status: 'COMPLETED', attachedMessage: `🎡 Giró la Ruleta ($${amountUsd.toFixed(2)} USD)` }
          });
          return { success: true, amountUsd };
        });

        const winningIndex = Math.floor(Math.random() * ROULETTE_OPTIONS.length);
        const prize = ROULETTE_OPTIONS[winningIndex];

        socket.to(streamId).emit('updateLiveGoal', { amount: giftResult.amountUsd });
        io.to(streamId).emit('rouletteSpun', { senderName: messageData.user?.username || 'Un Fan', prize: prize, amount: amountUsd });

        if (global.liveBattles[streamId] && global.liveBattles[streamId].active && Date.now() < global.liveBattles[streamId].endTime) {
          if (battleSide === 'right') global.liveBattles[streamId].rightScore += giftResult.amountUsd;
          else global.liveBattles[streamId].leftScore += giftResult.amountUsd;
          io.to(streamId).emit('battle:update', global.liveBattles[streamId]);
        }
      } catch (error) {
        if (error.message === "SALDO_INSUFICIENTE") socket.emit('error', { message: "No tienes suficiente saldo." });
      }
    });

    socket.on('broadcastMessage', async (messageData) => {
      const { streamId, senderId, amount: amountUsd, isDonation, text, isLike, battleSide, action } = messageData;
      if (isLike) return io.to(streamId).emit('newLiveMessage', messageData);

      if (!isDonation) {
        const slowMode = global.slowMode[streamId] || 0;
        const now = Date.now();
        if (slowMode > 0 && now - socket.data.lastMessageTime < slowMode * 1000) return;
        socket.data.lastMessageTime = now;
      }

      try {
        if (isDonation && amountUsd > 0) {
          // 1. Cobro Atómico
          const giftResult = await prisma.$transaction(async (tx) => {
            const senderWallet = await tx.wallet.findUnique({ where: { userId: senderId } });
            if (!senderWallet || senderWallet.balance < amountUsd) throw new Error("SALDO_INSUFICIENTE");

            // 🔥 Aquí pedimos el lovenseWebhook
            const stream = await tx.liveStream.findUnique({ 
              where: { id: streamId }, 
              select: { creatorId: true, creator: { select: { creatorProfile: true } } } 
            });
            
            const globalSettings = await tx.platformSetting.findFirst() || { feeTips: 20 };
            let feePercent = globalSettings.feeTips / 100;
            if (stream.creator?.creatorProfile?.customFeeTips != null) feePercent = stream.creator.creatorProfile.customFeeTips / 100;

            const fee = amountUsd * feePercent; const netAmount = amountUsd - fee; 

            await tx.wallet.update({ where: { userId: senderId }, data: { balance: { decrement: amountUsd } } });
            await tx.wallet.update({ where: { userId: stream.creatorId }, data: { balance: { increment: netAmount } } });
            
            await tx.transaction.create({ data: { senderId, receiverId: stream.creatorId, amount: amountUsd, platformFee: fee, netAmount: netAmount, type: 'TIP', status: 'COMPLETED', attachedMessage: `Regalo: ${text} ($${amountUsd.toFixed(2)} USD)` } });
            
            // Retornamos también el webhook para usarlo afuera de la transacción
            return { success: true, amountUsd, webhook: stream.creator?.creatorProfile?.lovenseWebhook };
          });

          // 2. Actualizar Metas y Batallas
          socket.to(streamId).emit('updateLiveGoal', { amount: giftResult.amountUsd });
          if (global.liveBattles[streamId] && global.liveBattles[streamId].active && Date.now() < global.liveBattles[streamId].endTime) {
            if (battleSide === 'right') global.liveBattles[streamId].rightScore += giftResult.amountUsd;
            else global.liveBattles[streamId].leftScore += giftResult.amountUsd;
            io.to(streamId).emit('battle:update', global.liveBattles[streamId]);
          }

          // 🧸 3. FASE 5: DISPARAR JUGUETE INTERACTIVO
          // Si el frontend manda un "action" que empiece con "vibrate" y el creador tiene un webhook guardado
          if (action && action.startsWith('vibrate') && giftResult.webhook) {
             console.log(`🧸⚡ Orden de vibración detectada. Disparando al juguete del creador...`);
             try {
                // Hacemos una petición silenciosa a la URL del juguete. (Lovense permite GET o POST).
                // Calculamos el tiempo de vibración basado en el dinero (Ej: 1 USD = 1 seg)
                const vibrateTime = Math.floor(amountUsd); 
                fetch(`${giftResult.webhook}&command=Function&action=Vibrate:20&timeSec=${vibrateTime}`, {
                   method: 'GET'
                }).catch(e => console.error("Fallo de conexión silenciosa con Lovense", e));
             } catch(err) { console.error("Error al disparar juguete", err); }
          }
        }
        io.to(streamId).emit('newLiveMessage', messageData);
      } catch (error) {
        if (error.message === "SALDO_INSUFICIENTE") socket.emit('error', { message: "No tienes suficiente saldo." });
      }
    });

    socket.on('streamEnded', ({ streamId }) => {
      delete global.liveBattles[streamId];
      delete global.liveGuests[streamId];
      delete global.slowMode[streamId];
      delete global.liveAuctions[streamId];
      socket.to(streamId).emit('streamKilled');
    });

    socket.on('activatePaywall', async ({ streamId, price }) => {
      try { await prisma.liveStream.update({ where: { id: streamId }, data: { isPPV: true, price: parseFloat(price) } }); } catch (error) {}
      socket.to(streamId).emit('paywallActivated', { price });
    });

    socket.on('disconnect', () => { if (socket.data.streamId) updateViewerCount(io, socket.data.streamId); });
  });
};

function updateViewerCount(io, streamId) {
  const room = io.sockets.adapter.rooms.get(streamId);
  let count = 0;
  if (room) {
    for (const id of room) { const s = io.sockets.sockets.get(id); if (s && !s.data.isGhost) count++; }
  }
  io.to(streamId).emit('viewerCountUpdated', { count });
}