// backend/workers/broadcastWorker.js
const { Worker } = require('bullmq');
const { connection } = require('../utils/queueSetup');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const socketHandler = require('../utils/socketHandler');

// Solo encendemos al trabajador si hay una conexión real a Redis
if (connection) {
  const worker = new Worker('broadcastMessages', async (job) => {
    const { creatorId, content, mediaUrl, isPPV, price, activeSubscribers } = job.data;
    
    console.log(`👷‍♂️ [Worker] Procesando envío masivo a ${activeSubscribers.length} fans...`);

    const broadcastMessages = activeSubscribers.map(sub => ({
      senderId: creatorId, receiverId: sub.fanId, content: content, mediaUrl: mediaUrl || null,
      isPPV: isPPV || false, price: isPPV ? parseFloat(price) : 0.0
    }));

    await prisma.message.createMany({ data: broadcastMessages });

    try {
      const io = socketHandler.getIO();
      activeSubscribers.forEach(sub => {
        io.to(sub.fanId).emit('nuevoMensaje', {
          senderId: creatorId, receiverId: sub.fanId, content: isPPV ? "🔒 Contenido Bloqueado" : content, isPPV
        });
      });
    } catch (error) {
      console.log('Socket no disponible en el worker.');
    }

    console.log(`✅ [Worker] Envío masivo completado con éxito.`);
  }, { connection });

  worker.on('failed', (job, err) => {
    console.error(`❌ [Worker] Error en el trabajo ${job.id}:`, err);
  });

  module.exports = worker;
} else {
  // Si no hay Redis, el trabajador se queda dormido para no causar errores
  module.exports = null;
}