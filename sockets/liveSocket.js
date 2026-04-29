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

          // 🚀 DISPARO DE NOTIFICACIONES (Solo si es el Creador y no es un Admin/Fantasma)
          if (isCreator && !socket.data.isGhost) {
            console.log(`📢 Creador detectado. Iniciando ráfaga de notificaciones para ${user?.username}...`);
            
            // Llamamos al servicio masivo que acabamos de blindar
            pushService.notifyFollowers(
              userId, 
              `¡${user?.username || 'Alguien'} ESTÁ EN VIVO! 🔥`, 
              "Entra ahora para ver el show exclusivo en FansMio.",
              `/live/${streamId}`
            );
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
    socket.on('broadcastMessage', async (messageData) => {
      const { streamId, senderId, amount, isDonation, text } = messageData;

      try {
        if (isDonation && amount > 0) {
          console.log(`💰 Procesando Donación Real de $${amount} USD...`);

          // 🛡️ TRANSACCIÓN ATÓMICA: El dinero se mueve o el evento muere.
          const giftResult = await prisma.$transaction(async (tx) => {
            
            // 1. Buscamos la billetera del fan
            const senderWallet = await tx.wallet.findUnique({
              where: { userId: senderId }
            });

            // 🛑 EL FILTRO: Si no hay plata, lanzamos error y abortamos
            if (!senderWallet || senderWallet.balance < amount) {
              throw new Error("SALDO_INSUFICIENTE");
            }

            // 2. Buscamos quién es el creador de este Live para pagarle
            const stream = await tx.liveStream.findUnique({
              where: { id: streamId },
              select: { creatorId: true }
            });

            if (!stream) throw new Error("STREAM_NO_ENCONTRADO");

            // 3. Calculamos la tajada (Ejemplo: 20% plataforma)
            const fee = amount * 0.20;
            const netAmount = amount - fee;

            // 4. RESTAMOS al fan y SUMAMOS al creador
            await tx.wallet.update({
              where: { userId: senderId },
              data: { balance: { decrement: amount } }
            });

            await tx.wallet.update({
              where: { userId: stream.creatorId },
              data: { balance: { increment: netAmount } }
            });

            // 5. Dejamos rastro legal en la tabla de transacciones
            await tx.transaction.create({
              data: {
                senderId,
                receiverId: stream.creatorId,
                amount: amount,
                platformFee: fee,
                type: 'GIFT_LIVE',
                status: 'COMPLETED',
                description: `Regalo en Vivo: ${text || 'Sin mensaje'}`
              }
            });

            return { success: true };
          });

          // Si la transacción fue un éxito, notificamos a la sala
          console.log(`💸 [SUPER CHAT] Lluvia REAL de $${amount} USD en sala ${streamId}`);
          socket.to(streamId).emit('updateLiveGoal', { amount: amount });
        }

        // Emitimos el mensaje a todos (sea texto normal o donación exitosa)
        io.to(streamId).emit('newLiveMessage', messageData);

      } catch (error) {
        if (error.message === "SALDO_INSUFICIENTE") {
          console.log(`❌ Intento de fraude: Usuario ${senderId} no tiene saldo.`);
          // Le avisamos SOLO al fan que su regalo no salió por pobre
          socket.emit('error', { message: "Saldo insuficiente. ¡Recarga para apoyar al creador! 💰" });
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