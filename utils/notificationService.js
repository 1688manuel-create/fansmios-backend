// backend/utils/notificationService.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const socketHandler = require('./socketHandler'); // 📻 NUEVO: Traemos el Walkie-Talkie

exports.sendNotification = async ({ userId, type, content, sendEmail = false, sendPush = false }) => {
  try {
    // 1. IN-APP: Guardamos en la base de datos
    const notification = await prisma.notification.create({
      data: { userId, type, content, isRead: false }
    });

    // 🚀 MAGIA EN TIEMPO REAL: Hacemos que la campanita brinque sin recargar la página
    try {
      const io = socketHandler.getIO();
      io.to(userId).emit('nuevaNotificacion', notification);
    } catch (socketError) {
      console.log('Socket no disponible aún para notificaciones.');
    }

    // 2. Buscamos preferencias de correo y push
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailNotifications: true, pushNotifications: true }
    });

    if (!user) return notification;

    // 3. EMAIL
    if (sendEmail && user.emailNotifications) {
      console.log(`✉️ [EMAIL ENVIADO a ${user.email}] Asunto: ${type} | Mensaje: ${content}`);
    }

    // 4. PUSH
    if (sendPush && user.pushNotifications) {
      console.log(`📱 [PUSH NOTIFICATION al usuario ${userId}] | Mensaje: ${content}`);
    }

    return notification;
  } catch (error) {
    console.error('Error en el Motor de Notificaciones:', error);
  }
};