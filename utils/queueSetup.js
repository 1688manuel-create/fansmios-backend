// backend/utils/queueSetup.js
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL; // Leeremos la URL del .env

let broadcastQueue;
let connection = null;

if (REDIS_URL) {
  // Si hay una URL real, conectamos el sistema profesional
  connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', () => {}); // Silenciamos los errores visuales
  broadcastQueue = new Queue('broadcastMessages', { connection });
} else {
  // MODO SIMULACIÓN PARA DESARROLLO LOCAL
  console.log('⚠️ Aviso: REDIS_URL no está configurado. El sistema de colas está en modo SIMULACIÓN.');
  broadcastQueue = {
    add: async (name, data) => {
      console.log(`⏱️ [Cola Simulada] El mensaje masivo fue recibido y se procesaría aquí.`);
      return true;
    }
  };
}

module.exports = { broadcastQueue, connection };