const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log("📡 [COVRA RADAR] Webhook recibido con status:", payload.status);

    res.status(200).send('Webhook recibido con éxito');

    const status = payload.status; 
    const amount = parseFloat(payload.filled_amount_in_usd || 0); 
    const userId = payload.customer_id; 

    if (status === 'FILLED' || status === 'OVER_FILLED' || status === 'COMPLETED') {
      
      if (!userId) return;

      console.log(`💰 ¡Inyectando combustible! $${amount} para el usuario ID: ${userId}`);

      // 1. Actualizamos la Billetera (Esto ya funciona ✅)
      await prisma.wallet.update({
        where: { userId: userId },
        data: {
          balance: { increment: amount }
        }
      });

      // 2. Registramos la Transacción (Corregido con platformFee ✅)
      await prisma.transaction.create({
        data: {
          amount: amount,
          netAmount: amount,
          platformFee: 0, // 👈 El ingrediente secreto que faltaba
          type: 'CREDIT_TOPUP',
          status: 'COMPLETED',
          senderId: userId, 
          receiverId: userId,
          description: `Recarga de saldo vía Covra Pay`
        }
      });

      console.log(`✅ ¡OPERACIÓN TRIUNFAL! Saldo acreditado y transaccion registrada.`);
    }

  } catch (error) {
    console.error("❌ Error crítico en el radar de Webhooks:", error);
  }
};