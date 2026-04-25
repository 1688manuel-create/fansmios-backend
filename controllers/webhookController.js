const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log("📡 [COVRA RADAR] Webhook recibido con status:", payload.status);

    // 1. Respondemos rápido con un 200 OK para que Covra Pay no reintente el envío
    res.status(200).send('Webhook recibido con éxito');

    // 2. Extraemos los datos exactos del diccionario de Covra Pay
    const status = payload.status; 
    // Usamos filled_amount_in_usd para inyectar los dólares exactos que llegaron
    const amount = parseFloat(payload.filled_amount_in_usd || 0); 
    // Covra Pay guarda el ID de tu Fan en 'customer_id'
    const userId = payload.customer_id; 

    // 3. Aceptamos pagos exactos (FILLED) o pagos con centavos extra (OVER_FILLED)
    if (status === 'FILLED' || status === 'OVER_FILLED' || status === 'COMPLETED') {
      
      if (!userId) {
        console.error("❌ Error: El webhook no incluyó el ID del usuario.");
        return;
      }

      console.log(`💰 ¡Bóveda Abierta! Inyectando $${amount} al usuario ID: ${userId}`);

      // 4. Inyectamos el saldo exacto en la billetera del usuario
      await prisma.user.update({
        where: { id: userId },
        data: {
          walletBalance: {
            increment: amount
          }
        }
      });

      // 5. Registramos el movimiento en su estado de cuenta
      await prisma.transaction.create({
        data: {
          amount: amount,
          netAmount: amount, // En recargas no hay comisión de plataforma
          type: 'CREDIT_TOPUP',
          status: 'COMPLETED',
          senderId: userId, 
          receiverId: userId,
          description: `Recarga de saldo vía Covra Pay`
        }
      });

      console.log(`✅ ¡Misión Exitosa! Bóveda del Fan actualizada con $${amount}.`);
    } else {
      // Ignoramos en silencio los estados 'OPEN' o 'PENDING'
      console.log(`⏳ Webhook en espera. Estado del pago: ${status}`);
    }

  } catch (error) {
    console.error("❌ Error crítico procesando webhook de Covra Pay:", error);
  }
};