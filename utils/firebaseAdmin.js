// backend/utils/firebaseAdmin.js
const admin = require('firebase-admin');
const path = require('path');

// 🔥 IMPORTAMOS PRISMA PARA PODER LIMPIAR LA BASE DE DATOS
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Apuntamos al archivo de llaves que acabas de guardar
const serviceAccount = require(path.join(__dirname, '../firebase-key.json'));

// 🛡️ EL BLINDAJE ANTI-REINICIOS DE NODEMON
// Solo inicializamos Firebase si NO hay ninguna app corriendo ya en la memoria
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// Función maestra para disparar notificaciones Push
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return;

  const message = {
    notification: {
      title: title,
      body: body,
    },
    data: data, // Para enviar info extra (ej: el link para abrir el chat)
    token: fcmToken,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Push Notification enviada con éxito:', response);
  } catch (error) {
    // 🔥 EL BLINDAJE ANTI-CRASHEOS:
    if (error.code === 'messaging/registration-token-not-registered' || error.code === 'messaging/invalid-registration-token') {
      console.log(`⚠️ Token Push expirado o inválido. Limpiando Base de Datos en silencio...`);
      
      try {
        // Buscamos a los usuarios que tengan este token basura y se lo borramos
        await prisma.user.updateMany({
          where: { fcmToken: fcmToken },
          data: { fcmToken: null }
        });
      } catch (dbError) {
        // Si hay error en BD lo ignoramos para que la app siga fluyendo
      }
    } else {
      // Si es otro error diferente, solo mostramos el mensaje corto para no manchar la consola
      console.error('❌ Error enviando Push Notification:', error.message);
    }
  }
};

module.exports = { admin, sendPushNotification };