const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const status = payload.status;
    
    // 🎯 CLAVE: Capturamos lo que REALMENTE llegó en dólares
    const amountReal = parseFloat(payload.filled_amount_in_usd || 0); 
    const userId = payload.customer_id;
    const referenceId = payload.invoice_id || payload.reference_id;

    console.log(`📡 [COVRA RADAR] Recibido: ${status} | Dinero Real: $${amountReal} | User: ${userId}`);

    // 1. Respondemos OK para que la pasarela no se ponga pesada
    res.status(200).send('OK');

    // 🛡️ TOLERANCIA TOTAL: Aceptamos cualquier estado que signifique "Ya pagó"
    // Incluimos PARTIALLY_FILLED para esos casos de $0.999
    const estadosAceptados = ['FILLED', 'OVER_FILLED', 'PARTIALLY_FILLED', 'COMPLETED', 'SUCCESS'];

    if (estadosAceptados.includes(status)) {
      
      if (!userId || amountReal <= 0) {
        console.log("⚠️ Datos insuficientes para procesar saldo.");
        return;
      }

      // 🛡️ SEGURO ANTIDUPLICADOS: No queremos sumar dos veces el mismo invoice
      const txExiste = await prisma.transaction.findFirst({
        where: { payramReceiptId: referenceId, status: 'COMPLETED' }
      });

      if (txExiste) {
        console.log("⚠️ Este pago ya fue procesado y enlazado. Abortando duplicado.");
        return;
      }

      console.log(`💰 Acreditando monto real de $${amountReal} al usuario ${userId}...`);

      // ⚡ OPERACIÓN ATÓMICA: Sumar Saldo + Crear Recibo Histórico
      await prisma.$transaction([
        prisma.wallet.update({
          where: { userId: userId },
          data: { balance: { increment: amountReal } }
        }),
        prisma.transaction.create({
          data: {
            amount: amountReal,
            netAmount: amountReal,
            platformFee: 0, 
            type: 'CREDIT_TOPUP',
            status: 'COMPLETED', // 👈 Forzamos a COMPLETADO en FansMio para que sea verde
            senderId: userId, 
            receiverId: userId,
            description: `Recarga via Covra Pay (Monto Recibido: $${amountReal})`,
            payramReceiptId: referenceId
          }
        })
      ]);

      console.log(`✅ ¡OPERACIÓN EXITOSA! $${amountReal} inyectados y recibo generado.`);
    } else {
      console.log(`⏳ Pago aún no listo. Status actual: ${status}`);
    }

  } catch (error) {
    console.error("❌ Error crítico en el enlace del Webhook:", error);
  }
};