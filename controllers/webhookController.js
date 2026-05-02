// backend/controllers/webhookController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    const { key } = req.query; 
    const payload = req.body;

    // 🔐 1. Validación de Seguridad
    if (key !== process.env.PAYRAM_API_KEY) {
      return res.status(401).send('Unauthorized');
    }

    // 2. Respuesta rápida a Covra Pay
    res.status(200).send('OK');

    const status = payload.status?.toUpperCase(); 
    // Capturamos el monto EXACTO que llegó en cripto (Ej: 9.85 o 10.04)
    const amountReal = parseFloat(payload.filled_amount_in_usd || payload.amount || 0); 
    const userId = payload.customer_id; 
    const referenceId = payload.invoice_id || payload.reference_id || payload.id;

    console.log(`📡 [COVRA RADAR] Recibido: ${status} | Monto Pagado Real: $${amountReal}`);

    const estadosAceptados = ['FILLED', 'OVER_FILLED', 'PARTIALLY_FILLED', 'COMPLETED', 'SUCCESS'];

    if (estadosAceptados.includes(status)) {
      if (!userId || amountReal <= 0) return;

      // 🛡️ 3. Evitar pagos duplicados
      const txExiste = await prisma.transaction.findFirst({
        where: { payramReceiptId: referenceId }
      });

      if (txExiste) {
        console.log("⚠️ Pago ya registrado. Abortando.");
        return;
      }

      // ========================================================
      // 💵 4. ACREDITACIÓN DIRECTA EN DÓLARES (USD/USDC)
      // ========================================================
      
      const usdToAdd = amountReal; 

      console.log(`💵 Recarga directa: Acreditando $${usdToAdd} USD a la bóveda del usuario ${userId}...`);

      // ========================================================

      // ⚡ 5. OPERACIÓN ATÓMICA
      await prisma.$transaction([
        prisma.wallet.upsert({
          where: { userId: userId },
          update: { balance: { increment: usdToAdd } }, // 🔥 Sumamos DÓLARES directos
          create: { userId: userId, balance: usdToAdd, pendingBalance: 0, coinBalance: 0 }
        }),
        prisma.transaction.create({
          data: {
            amount: amountReal,       // Registramos el dólar exacto que ingresó ($9.85)
            netAmount: usdToAdd,      // Registramos los dólares exactos entregados
            platformFee: 0, 
            type: 'CREDIT_TOPUP',     
            status: 'COMPLETED',
            senderId: userId, 
            receiverId: userId,
            attachedMessage: `Recarga de Bóveda: $${usdToAdd} USD 💵`,
            payramReceiptId: referenceId
          }
        })
      ]);

      console.log(`✅ ¡ÉXITO TOTAL! $${usdToAdd} USD entregados al Fan.`);
    }

  } catch (error) {
    console.error("❌ [CRITICAL] Error en el Webhook:", error.message);
  }
};