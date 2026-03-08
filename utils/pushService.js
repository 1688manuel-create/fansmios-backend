// backend/utils/pushService.js
const admin = require('firebase-admin');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

// 1. Inicializamos Firebase Admin (Bilingüe y Seguro)
let serviceAccount = null;

try {
  if (process.env.FIREBASE_CREDENTIALS) {
    // Si estamos en la nube, usa la memoria secreta
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  } else {
    // Si estamos en la PC, revisamos que el archivo exista antes de abrirlo
    const keyPath = path.join(__dirname, '../firebase-adminsdk.json');
    if (fs.existsSync(keyPath)) {
      serviceAccount = require(keyPath);
    } else {
      console.log('⚠️ Aviso: No hay llave de Firebase, pero el servidor seguirá funcionando.');
    }
  }

  // Si logramos obtener la cuenta, encendemos Firebase
  if (serviceAccount && !admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase inicializado correctamente.');
  }
} catch (error) {
  console.error("⚠️ Error inicializando Firebase (No te preocupes, el servidor no se apagará):", error.message);
}

/**
 * Función para disparar notificaciones Push
 */
exports.sendPushNotification = async (userId, title, body, link) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true }
    });

    if (!user || !user.fcmToken) return; 

    const message = {
      notification: { title: title, body: body },
      data: { link: link || 'http://localhost:3000/dashboard/notifications' },
      token: user.fcmToken,
    };

    if (admin.apps.length) {
      await admin.messaging().send(message);
      console.log(`📱 Notificación Push enviada al usuario ${userId}`);
    }

  } catch (error) {
    console.error('❌ Error enviando Push Notification:', error);
  }
};