const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log("📡 [PAYRAM RADAR] Webhook recibido:", payload);

    // 1. PayRam exige que le respondamos un 200 OK rápido para que sepa que recibimos el mensaje
    res.status(200).send('Webhook recibido con éxito');

    // 2. Extraemos los datos del pago (Ajusta estos campos según la documentación exacta de PayRam)
    // Normalmente envían un status, el monto y el ID de la transacción o del usuario
    const status = payload.status || payload.payment_status; 
    const amount = parseFloat(payload.amount || payload.net_amount || 0);
    const userId = payload.custom_id || payload.metadata?.userId; // Depende de cómo enviaste el ID en el checkout

    // 3. Verificamos que el pago se haya completado con éxito
    if (status === 'completed' || status === 'success' || status === 'paid') {
      
      if (!userId) {
        console.error("❌ Error: El webhook de PayRam no incluyó el ID del usuario.");
        return;
      }

      console.log(`💰 Procesando recarga de $${amount} para el usuario ID: ${userId}`);

      // 4. Inyectamos el saldo en la billetera del usuario en Prisma
      await prisma.user.update({
        where: { id: userId },
        data: {
          walletBalance: {
            increment: amount
          }
        }
      });

      // 5. Registramos el movimiento en el historial de transacciones
      await prisma.transaction.create({
        data: {
          amount: amount,
          netAmount: amount,
          type: 'CREDIT_TOPUP',
          status: 'COMPLETED',
          senderId: userId, // En una recarga, el sender y receiver es el mismo usuario
          receiverId: userId,
          description: `Recarga de saldo vía PayRam`
        }
      });

      console.log(`✅ ¡Bóveda actualizada! Saldo de $${amount} inyectado al usuario ${userId}.`);
    } else {
      console.log(`⚠️ Webhook ignorado. Estado del pago: ${status}`);
    }

  } catch (error) {
    console.error("❌ Error crítico procesando webhook de PayRam:", error);
  }
};