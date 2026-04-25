const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log("📡 [COVRA RADAR] Webhook recibido con status:", payload.status);

    // 1. Respondemos rápido para que la pasarela deje de reintentar
    res.status(200).send('Webhook recibido con éxito');

    const status = payload.status; 
    const amount = parseFloat(payload.filled_amount_in_usd || 0); 
    const userId = payload.customer_id; 

    // 2. Filtramos por estados de éxito
    if (status === 'FILLED' || status === 'OVER_FILLED' || status === 'COMPLETED') {
      
      if (!userId) {
        console.error("❌ Error: El webhook no incluyó el ID del usuario.");
        return;
      }

      console.log(`💰 ¡Inyectando combustible! $${amount} para el usuario ID: ${userId}`);

      // 🎯 CORRECCIÓN: Actualizamos la tabla 'wallet', no la tabla 'user'
      await prisma.wallet.update({
        where: { userId: userId }, // Buscamos la billetera por el ID del dueño
        data: {
          balance: {
            increment: amount // Sumamos el dinero al campo 'balance'
          }
        }
      });

      // 3. Registramos la transacción en el historial
      await prisma.transaction.create({
        data: {
          amount: amount,
          netAmount: amount,
          type: 'CREDIT_TOPUP',
          status: 'COMPLETED',
          senderId: userId, 
          receiverId: userId,
          description: `Recarga de saldo vía Covra Pay`
        }
      });

      console.log(`✅ ¡Misión Exitosa! Billetera del usuario ${userId} actualizada.`);
    } else {
      console.log(`⏳ Webhook ignorado. Estado: ${status}`);
    }

  } catch (error) {
    console.error("❌ Error crítico en el radar de Webhooks:", error);
  }
};