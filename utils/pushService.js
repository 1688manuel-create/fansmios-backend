const admin = require('firebase-admin');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

// Inicialización de Firebase (Se mantiene igual)
let serviceAccount = null;
try {
  if (process.env.FIREBASE_CREDENTIALS) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  } else {
    const keyPath = path.join(__dirname, '../firebase-adminsdk.json');
    if (fs.existsSync(keyPath)) serviceAccount = require(keyPath);
  }
  if (serviceAccount && !admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('✅ Firebase Nivel 5 Activado.');
  }
} catch (error) { console.error("⚠️ Error Firebase:", error.message); }

/**
 * 🚀 NOTIFICACIÓN MASIVA (Ajustada a tu Schema)
 */
exports.notifyFollowers = async (creatorId, title, body, link) => {
  try {
    const followers = await prisma.follow.findMany({
      where: { followingId: creatorId },
      include: { follower: { select: { id: true, fcmToken: true } } }
    });

    if (followers.length === 0) return;

    const tokens = followers.map(f => f.follower.fcmToken).filter(t => t !== null);

    // 🎯 AJUSTE QUIRÚRGICO: Usamos 'content' e 'isRead' como en tu modelo
    await prisma.notification.createMany({
      data: followers.map(f => ({
        userId: f.follower.id,
        type: 'LIVE_START',
        content: `${title}: ${body}`, // Combinamos para que no se pierda información
        link: link || '/dashboard/notifications',
        isRead: false // Nombre exacto de tu modelo
      }))
    });

    if (admin.apps.length && tokens.length > 0) {
      const message = {
        notification: { title, body },
        data: { link: link || `${process.env.FRONTEND_URL}/dashboard/notifications` },
        tokens: tokens,
      };
      await admin.messaging().sendEachForMulticast(message);
      console.log(`📱 Push Masivo enviado a ${tokens.length} seguidores.`);
    }
  } catch (error) { console.error('❌ Error en Notificación Masiva:', error); }
};

/**
 * NOTIFICACIÓN INDIVIDUAL (Ajustada a tu Schema)
 */
exports.sendPushNotification = async (userId, title, body, link) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true }
    });

    if (!user) return;

    // 🎯 AJUSTE QUIRÚRGICO: Usamos 'content' e 'isRead'
    await prisma.notification.create({
      data: { 
        userId, 
        type: 'PRIVATE_MESSAGE', 
        content: `${title}: ${body}`, 
        link: link || '/dashboard/notifications', 
        isRead: false 
      }
    });

    if (admin.apps.length && user.fcmToken) {
      const message = {
        notification: { title, body },
        data: { link: link || `${process.env.FRONTEND_URL}/dashboard/notifications` },
        token: user.fcmToken,
      };
      await admin.messaging().send(message);
    }
  } catch (error) { console.error('❌ Error en Push Individual:', error); }
};