// backend/cron/accountGuardian.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * 🐕 EL PERRO GUARDIÁN (Protocolo de Hibernación)
 * Objetivo: Pausar cuentas inactivas por 5 meses para proteger a los fans.
 */
const startAccountGuardian = () => {
  // Se ejecuta todos los días a las 3:00 AM
  cron.schedule('0 3 * * *', async () => {
    console.log('🐕 [CRON] Perro Guardián iniciando patrullaje de inactividad...');

    try {
      // 1. Calculamos la fecha límite (hace exactamente 5 meses)
      const fiveMonthsAgo = new Date();
      fiveMonthsAgo.setMonth(fiveMonthsAgo.getMonth() - 5);

      // 2. Buscamos creadores activos que no han entrado en 5 meses
      const inactiveCreators = await prisma.user.findMany({
        where: {
          role: 'CREATOR',
          status: 'ACTIVE',
          lastLoginAt: {
            lt: fiveMonthsAgo // Login menor a hace 5 meses
          }
        }
      });

      if (inactiveCreators.length === 0) {
        console.log('✅ [CRON] Todos los creadores han estado activos últimamente.');
        return;
      }

      console.log(`⚠️ [CRON] Detectados ${inactiveCreators.length} creadores inactivos. Aplicando Protocolo de Hibernación...`);

      for (const creator of inactiveCreators) {
        try {
          await prisma.$transaction(async (db) => {
            // A. Cambiamos estatus a SUSPENDED (Hibernación)
            await db.user.update({
              where: { id: creator.id },
              data: { status: 'SUSPENDED' }
            });

            // B. Cancelamos suscripciones activas para evitar cobros a fans
            await db.subscription.updateMany({
              where: { 
                creatorId: creator.id,
                status: 'ACTIVE' 
              },
              data: { status: 'CANCELED' }
            });

            // C. Dejamos un aviso para cuando el creador decida volver
            await db.notification.create({
              data: {
                userId: creator.id,
                type: 'SYSTEM_ALERT',
                content: '🥶 Tu cuenta ha sido enviada a hibernación por 5 meses de inactividad. Tus suscripciones activas fueron canceladas por seguridad.'
              }
            });
          });

          console.log(`🥶 [CRON] @${creator.username || creator.email} ha sido hibernado.`);
        } catch (error) {
          console.error(`🚨 Error hibernando al creador ${creator.id}:`, error);
        }
      }

    } catch (error) {
      console.error('🚨 Error crítico en el Perro Guardián:', error);
    }
  });
};

module.exports = startAccountGuardian;