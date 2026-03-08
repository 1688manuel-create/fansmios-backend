// backend/utils/pushService.js
const admin = require('firebase-admin');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. Inicializamos Firebase Admin con tu Llave Maestra
const serviceAccount = require('../firebase-adminsdk.json'); 

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

/**
 * Función para disparar notificaciones Push
 * @param {string} userId - ID del usuario que recibe la alerta
 * @param {string} title - Título del mensaje (Ej: "¡Nueva Propina!")
 * @param {string} body - Texto principal
 * @param {string} link - URL a donde lo llevará si hace clic
 */
exports.sendPushNotification = async (userId, title, body, link) => {
  try {
    // Buscamos si el usuario tiene un celular/PC vinculado (fcmToken)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true }
    });

    if (!user || !user.fcmToken) {
      return; // Si no tiene token, simplemente ignoramos y no enviamos nada
    }

    // Armamos el misil (El mensaje)
    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        link: link || 'http://localhost:3000/dashboard/notifications'
      },
      token: user.fcmToken, // Apuntamos al dispositivo exacto
    };

    // ¡Fuego! 🔥
    await admin.messaging().send(message);
    console.log(`📱 Notificación Push disparada con éxito al usuario ${userId}`);

  } catch (error) {
    console.error('❌ Error enviando Push Notification:', error);
  }
};