// backend/utils/subscriptionCron.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * 🤖 EL ROBOT DE SUSCRIPCIONES (Fase 4)
 * Objetivo: Ejecutarse todos los días a medianoche.
 * 1. Buscar VIPs cuyo tiempo (30 días) se agotó y bloquearles el acceso.
 * 2. Enviar alertas de renovación a los que les quedan 24 horas.
 */
const startSubscriptionCron = () => {
  // Cron Expression: '0 0 * * *' significa "A las 00:00 (Medianoche) todos los días"
  cron.schedule('0 0 * * *', async () => {
    console.log('🤖 [CRON-SUB] Iniciando auditoría diaria de Suscripciones VIP...');

    try {
      const now = new Date();

      // ==========================================
      // 1. EXPIRACIÓN Y AUTO-BLOQUEO (Día 30)
      // ==========================================
      const expiredSubs = await prisma.subscription.findMany({
        where: {
          status: 'ACTIVE',
          endDate: { lte: now } // Si la fecha de caducidad ya pasó
        },
        include: { creator: true }
      });

      if (expiredSubs.length > 0) {
        console.log(`🤖 [CRON-SUB] Revocando acceso a ${expiredSubs.length} suscripciones vencidas...`);
        
        let revokedCount = 0;
        for (const sub of expiredSubs) {
          try {
            await prisma.$transaction(async (db) => {
              // A. Cambiamos el estatus para que el Feed le vuelva a salir bloqueado (🔒)
              await db.subscription.update({
                where: { id: sub.id },
                data: { status: 'EXPIRED' }
              });

              // B. Le avisamos al Fan en su campanita de notificaciones
              await db.notification.create({
                data: {
                  userId: sub.fanId,
                  type: 'SUBSCRIPTION_EXPIRED',
                  content: `Tu suscripción VIP con @${sub.creator.username} ha expirado. ¡Renueva ahora para no perderte nada!`
                }
              });
            });
            revokedCount++;
          } catch (err) {
            console.error(`🚨 Error al expirar suscripción ${sub.id}:`, err);
          }
        }
        console.log(`✅ [CRON-SUB] Se revocaron ${revokedCount} accesos VIP.`);
      } else {
        console.log('🤖 [CRON-SUB] Ninguna suscripción expiró hoy.');
      }

      // ==========================================
      // 2. ALERTAS DE RETENCIÓN (Aviso de 24 Horas)
      // ==========================================
      const in24Hours = new Date(now.getTime() + (24 * 60 * 60 * 1000));

      const subsExpiringSoon = await prisma.subscription.findMany({
        where: {
          status: 'ACTIVE',
          reminderSent: false, // Solo le avisamos una vez para no hacer SPAM
          endDate: {
            lte: in24Hours, // Caducan en menos de 24h
            gt: now         // Pero aún no han caducado
          }
        },
        include: { creator: true }
      });

      if (subsExpiringSoon.length > 0) {
        console.log(`🤖 [CRON-SUB] Enviando ${subsExpiringSoon.length} avisos de renovación (24h)...`);
        
        for (const sub of subsExpiringSoon) {
          try {
            await prisma.$transaction(async (db) => {
              // Marcamos que ya se le avisó
              await db.subscription.update({
                where: { id: sub.id },
                data: { reminderSent: true }
              });

              // Enviamos la Notificación Push/In-App para que meta tarjeta
              await db.notification.create({
                data: {
                  userId: sub.fanId,
                  type: 'SUBSCRIPTION_REMINDER',
                  content: `⏳ Tu acceso VIP de @${sub.creator.username} caduca en menos de 24 horas. ¡Renueva tu suscripción para seguir viendo su contenido privado!`
                }
              });
            });
          } catch (err) {
             console.error(`🚨 Error al enviar recordatorio a sub ${sub.id}:`, err);
          }
        }
      }

      console.log('✅ [CRON-SUB] Auditoría de suscripciones completada con éxito.');

    } catch (error) {
      console.error('🚨 Error crítico en el Robot de Suscripciones:', error);
    }
  });
};

module.exports = { startSubscriptionCron };