const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log("📡 [COVRA RADAR] Procesando pago:", payload.invoice_id);

    // 1. Respondemos 200 OK de inmediato para que Covra Pay esté tranquilo
    res.status(200).send('OK');

    const status = payload.status; 
    const amount = parseFloat(payload.filled_amount_in_usd || 0); 
    const userId = payload.customer_id; 
    // Usamos el invoice_id como huella digital única
    const referenceId = payload.invoice_id;

    if (status === 'FILLED' || status === 'OVER_FILLED' || status === 'COMPLETED') {
      
      // 🛡️ SEGURO ANTIDUPLICADOS: Buscamos si ya procesamos este pago
      const txExiste = await prisma.transaction.findFirst({
        where: { payramReceiptId: referenceId }
      });

      if (txExiste) {
        console.log("⚠️ Alerta: Este pago ya fue procesado. Evitando duplicidad de saldo.");
        return;
      }

      console.log(`💰 Enlazando $${amount} a la billetera del usuario: ${userId}`);

      // 2. OPERACIÓN MAESTRA: Todo o nada
      await prisma.$transaction([
        prisma.wallet.update({
          where: { userId: userId },
          data: { balance: { increment: amount } }
        }),
        prisma.transaction.create({
          data: {
            amount: amount,
            netAmount: amount,
            platformFee: 0, 
            type: 'CREDIT_TOPUP',
            status: 'COMPLETED',
            senderId: userId, 
            receiverId: userId,
            description: `Recarga exitosa vía Covra Pay`,
            payramReceiptId: referenceId // 👈 Esto es lo que crea el "enlace"
          }
        })
      ]);

      console.log(`✅ ¡OPERACIÓN TRIUNFAL! Saldo enlazado y visible en el historial.`);
    }

  } catch (error) {
    console.error("❌ Error en el radar de Webhooks:", error);
  }
};