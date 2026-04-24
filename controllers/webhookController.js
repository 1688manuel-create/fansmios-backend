// backend/controllers/webhookController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 📡 RADAR PAYRAM: RECEPTOR DE FONDOS
// ==========================================

exports.handlePayRamWebhook = async (req, res) => {
  try {
    // 1. 🛡️ ESCUDO ADAPTATIVO: Buscar la llave en la URL (?key=...)
    const apiKey = req.query.key || req.headers['api-key'] || req.headers['x-api-key'];
    
    if (apiKey !== process.env.PAYRAM_API_KEY) {
      console.error("🚨 INTRUSO DETECTADO: Webhook rechazado por llave inválida.");
      return res.status(401).json({ error: 'No autorizado' });
    }

    const payload = req.body;
    console.log("📡 Señal de PayRam recibida:", payload);

    // 2. Extraer los datos del recibo
    // Ampliamos el radar por si PayRam cambió los nombres de sus variables en su última actualización
    const referenceId = payload.referenceId || payload.reference_id || payload.orderId || payload.id;
    const status = payload.status || payload.event || payload.paymentStatus; 

    if (!referenceId) {
      return res.status(400).json({ error: 'El payload no incluye un ID de referencia.' });
    }

    // 3. Verificamos si el pago fue exitoso
    const isSuccess = status === 'PAID' || status === 'COMPLETED' || status === 'SUCCESS' || status === 'payment.success' || status === 'successful';

    if (isSuccess) {
      // Buscamos la transacción PENDIENTE en nuestra base de datos
      const transaction = await prisma.transaction.findFirst({
        where: { payramReceiptId: referenceId }
      });

      if (!transaction) {
        console.error(`❌ Transacción fantasma: No existe recibo para ${referenceId}`);
        return res.status(404).json({ error: 'Transacción no encontrada' });
      }

      // 🛑 BLINDAJE ANTI-DUPLICADOS (Idempotencia)
      // Si PayRam envía el aviso dos veces por error de red, evitamos regalarle el saldo dos veces al Fan.
      if (transaction.status === 'COMPLETED') {
        console.log(`⚠️ Recibo ${referenceId} ya estaba acreditado. Ignorando.`);
        return res.status(200).send('OK');
      }

      // 4. 💰 OPERACIÓN CRÍTICA: INYECTAR EL DINERO AL FAN
      if (transaction.type === 'CREDIT_TOPUP') {
        
        await prisma.$transaction(async (db) => {
          // A. Marcar el recibo como Pagado
          await db.transaction.update({
            where: { id: transaction.id },
            data: { status: 'COMPLETED' }
          });

          // B. Subir el saldo disponible a la billetera del Fan para que pueda gastarlo
          await db.wallet.upsert({
            where: { userId: transaction.senderId },
            update: { balance: { increment: transaction.amount } },
            create: { userId: transaction.senderId, balance: transaction.amount }
          });

          // C. Notificar al Fan en su app
          await db.notification.create({
            data: {
              userId: transaction.senderId,
              type: 'SYSTEM',
              content: `✅ ¡Recarga Exitosa! Tus $${transaction.amount} USD ya están listos para usarse en FansMio. ⚡`,
              link: '/dashboard/wallet'
            }
          });
        });

        console.log(`✅ MISIÓN CUMPLIDA: Se fondearon $${transaction.amount} a la bóveda del Fan.`);
      }
    }

    // 5. Confirmar recepción a PayRam
    // Siempre debemos responder 200 OK rápido para que PayRam sepa que lo recibimos.
    res.status(200).send('Webhook procesado correctamente');

  } catch (error) {
    console.error("❌ Error Crítico en el Radar de PayRam:", error);
    res.status(500).send('Internal Server Error');
  }
};