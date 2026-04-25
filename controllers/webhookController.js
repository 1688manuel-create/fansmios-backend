const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    const { key } = req.query; 
    const payload = req.body;

    // 🔐 1. Validación de Seguridad
    if (key !== process.env.PAYRAM_API_KEY) {
      console.log("❌ [SECURITY] Key inválida.");
      return res.status(401).send('Unauthorized');
    }

    // 2. Respuesta rápida a la pasarela
    res.status(200).send('OK');

    const status = payload.status?.toUpperCase(); 
    const amountReal = parseFloat(payload.filled_amount_in_usd || 0); 
    const userId = payload.customer_id;
    const referenceId = payload.invoice_id || payload.reference_id;

    console.log(`📡 [COVRA RADAR] Recibido: ${status} | Monto: $${amountReal}`);

    // 🛡️ 3. Filtro de éxito (Acepta parciales como $0.99)
    const estadosAceptados = ['FILLED', 'OVER_FILLED', 'PARTIALLY_FILLED', 'COMPLETED', 'SUCCESS'];

    if (estadosAceptados.includes(status)) {
      
      if (!userId || amountReal <= 0) return;

      // 🛡️ 4. Evitar duplicados
      const txExiste = await prisma.transaction.findFirst({
        where: { payramReceiptId: referenceId }
      });

      if (txExiste) {
        console.log("⚠️ Pago ya registrado. Abortando.");
        return;
      }

      console.log(`💰 Acreditando $${amountReal} a Wallet del usuario ${userId}...`);

      // ⚡ 5. Operación Atómica (Billetera + Historial)
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
            status: 'COMPLETED',
            senderId: userId, 
            receiverId: userId,
            // 🎯 FIX: Usamos attachedMessage porque 'description' NO existe en tu prisma
            attachedMessage: `Recarga via Covra Pay (Monto: $${amountReal})`,
            payramReceiptId: referenceId
          }
        })
      ]);

      console.log(`✅ ¡ÉXITO TOTAL! Saldo e historial actualizados.`);
    }

  } catch (error) {
    console.error("❌ [CRITICAL] Error en el Webhook:", error.message);
  }
};