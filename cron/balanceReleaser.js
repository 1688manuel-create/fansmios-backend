// backend/cron/balanceReleaser.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * 🤖 EL ROBOT DEL BANCO (Custodial Balance System)
 * Objetivo: Mover el dinero... exactamente 7 días después del pago.
 */
const startBalanceReleaser = () => {
  // Se ejecuta cada hora, en el minuto 0 (Ej: 1:00, 2:00, 3:00...)
  cron.schedule('0 * * * *', async () => {
    console.log('🏦 [CRON] Iniciando auditoría de liberación de fondos (7 días)...');

    try {
      // 1. Calculamos la fecha límite (hace exactamente 7 días)
      const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));

      // 2. Buscamos todas las transacciones COMPLETADAS que aún no se han liberado
      // *Nota: Asegúrate de tener el campo `fundsReleased: Boolean @default(false)` en tu modelo Transaction.
      const pendingTransactions = await prisma.transaction.findMany({
        where: {
          status: 'COMPLETED',
          fundsReleased: false,       // Aún no liberado
          createdAt: {
            lte: sevenDaysAgo   // Su última actualización fue hace 7 días o más
          }
        }
      });

      if (pendingTransactions.length === 0) {
        console.log('🏦 [CRON] No hay fondos maduros para liberar en esta hora.');
        return;
      }

      console.log(`🏦 [CRON] Encontradas ${pendingTransactions.length} transacciones listas para liberar. Procesando...`);

      // 3. Procesamos una por una con transacciones seguras (ACID)
      let releasedCount = 0;
      let totalMoneyMoved = 0;

      for (const tx of pendingTransactions) {
        try {
          await prisma.$transaction(async (db) => {
            // A. Restamos del Pendiente y Sumamos al Disponible
            await db.wallet.update({
              where: { userId: tx.receiverId },
              data: {
                pendingBalance: { decrement: tx.netAmount },
                balance: { increment: tx.netAmount } // Este es el saldo retirable
              }
            });

            // B. Marcamos la transacción como liberada para que no se procese doble
            await db.transaction.update({
              where: { id: tx.id },
              data: { fundsReleased: true }
            });
            
            // C. (Opcional) Notificamos al creador que su dinero ya está disponible
            await db.notification.create({
              data: {
                userId: tx.receiverId,
                type: 'FUNDS_AVAILABLE',
                content: `¡Tus fondos por $${tx.netAmount.toFixed(2)} USD ya están disponibles para retiro!`
              }
            });
          });

          releasedCount++;
          totalMoneyMoved += tx.netAmount;
        } catch (txError) {
          console.error(`🚨 Error liberando fondos para TX ${tx.id}:`, txError);
          // Si falla una, el loop continúa con las demás
        }
      }

      console.log(`✅ [CRON] Éxito: Se liberaron $${totalMoneyMoved.toFixed(2)} USD en ${releasedCount} cuentas.`);

    } catch (error) {
      console.error('🚨 Error crítico en el Robot de Liberación de Saldos:', error);
    }
  });
};

module.exports = startBalanceReleaser;