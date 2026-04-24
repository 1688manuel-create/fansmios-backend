// backend/controllers/webhookController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 📡 RADAR PAYRAM: RECEPTOR DE FONDOS
// ==========================================

exports.handlePayRamWebhook = async (req, res) => {
  try {
    // 1. 🛡️ ESCUDO ADAPTATIVO: Buscar la llave en la URL
    const apiKey = req.query.key || req.headers['api-key'] || req.headers['x-api-key'];
    
    if (apiKey !== process.env.PAYRAM_API_KEY) {
      console.error("🚨 INTRUSO DETECTADO: Webhook rechazado por llave inválida.");
      return res.status(401).json({ error: 'No autorizado' });
    }

    const payload = req.body;
    console.log("📡 Señal de PayRam recibida:", payload);

    const referenceId = payload.referenceId || payload.reference_id || payload.orderId || payload.id;
    const status = payload.status || payload.event || payload.paymentStatus; 

    if (!referenceId) {
      return res.status(400).json({ error: 'El payload no incluye un ID de referencia.' });
    }

    // 3. 🔥 NUEVO: Aceptamos pagos completos, parciales y sobrepagos
    const validStatuses = ['PAID', 'COMPLETED', 'SUCCESS', 'payment.success', 'successful', 'PARTIALLY_FILLED', 'OVERPAID'];
    const isSuccess = validStatuses.includes(status);

    if (isSuccess) {
      const transaction = await prisma.transaction.findFirst({
        where: { payramReceiptId: referenceId }
      });

      if (!transaction) {
        console.error(`❌ Transacción fantasma: No existe recibo para ${referenceId}`);
        return res.status(404).json({ error: 'Transacción no encontrada' });
      }

      if (transaction.status === 'COMPLETED') {
        console.log(`⚠️ Recibo ${referenceId} ya estaba acreditado. Ignorando.`);
        return res.status(200).send('OK');
      }

      // 💰 CALCULAR EL MONTO REAL RECIBIDO (Cripto-Resiliencia)
      // Si PayRam nos dice exactamente cuántos dólares entraron, usamos ese número.
      let amountToCredit = transaction.amount;
      if (payload.filled_amount_in_usd) {
        amountToCredit = parseFloat(payload.filled_amount_in_usd);
      }

      // Si por alguna razón el monto es 0, abortamos.
      if (amountToCredit <= 0) {
        return res.status(200).send('Ignorado por monto en cero');
      }

      // 4. 💰 OPERACIÓN CRÍTICA: INYECTAR EL DINERO AL FAN
      if (transaction.type === 'CREDIT_TOPUP') {
        
        await prisma.$transaction(async (db) => {
          // A. Marcar el recibo como Pagado y ajustar al monto REAL
          await db.transaction.update({
            where: { id: transaction.id },
            data: { 
              status: 'COMPLETED',
              amount: amountToCredit 
            }
          });

          // B. Subir el saldo
          await db.wallet.upsert({
            where: { userId: transaction.senderId },
            update: { balance: { increment: amountToCredit } },
            create: { userId: transaction.senderId, balance: amountToCredit }
          });

          // C. Notificar al Fan
          await db.notification.create({
            data: {
              userId: transaction.senderId,
              type: 'SYSTEM',
              content: `✅ ¡Recarga Exitosa! Tus $${amountToCredit.toFixed(2)} USD ya están listos para usarse en FansMio. ⚡`,
              link: '/dashboard/wallet'
            }
          });
        });

        console.log(`✅ MISIÓN CUMPLIDA: Se fondearon $${amountToCredit.toFixed(2)} a la bóveda del Fan.`);
      }
    }

    res.status(200).send('Webhook procesado correctamente');

  } catch (error) {
    console.error("❌ Error Crítico en el Radar de PayRam:", error);
    res.status(500).send('Internal Server Error');
  }
};