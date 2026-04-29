// backend/controllers/webhookController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    const { key } = req.query; 
    const payload = req.body;

    // 🔐 1. Validación de Seguridad
    if (key !== process.env.PAYRAM_API_KEY) {
      console.log("❌ [SECURITY] Key de Webhook inválida.");
      return res.status(401).send('Unauthorized');
    }

    // 2. Respuesta rápida para que PayRam sepa que recibimos el aviso
    res.status(200).send('OK');

    const status = payload.status?.toUpperCase(); 
    const amountReal = parseFloat(payload.filled_amount_in_usd || payload.amount || 0); 
    const customerPayload = payload.customer_id || ""; 
    const referenceId = payload.invoice_id || payload.reference_id || payload.id;

    console.log(`📡 [COVRA RADAR] Recibido: ${status} | Monto Pagado: $${amountReal}`);

    const estadosAceptados = ['FILLED', 'OVER_FILLED', 'PARTIALLY_FILLED', 'COMPLETED', 'SUCCESS'];

    if (estadosAceptados.includes(status)) {
      if (!customerPayload || amountReal <= 0) return;

      // 🐎 3. DESENCRIPTAR EL CABALLO DE TROYA
      // El payload viene así: "userId:::1050"
      const [userId, coinsStr] = customerPayload.split(':::');
      const coinsToAdd = parseInt(coinsStr) || Math.floor(amountReal * 100); // Fallback por si acaso

      if (!userId) return;

      // 🛡️ 4. Evitar pagos duplicados
      const txExiste = await prisma.transaction.findFirst({
        where: { payramReceiptId: referenceId }
      });

      if (txExiste) {
        console.log("⚠️ Pago ya registrado. Abortando.");
        return;
      }

      console.log(`🪙 Acreditando ${coinsToAdd} MONEDAS a la Bóveda del usuario ${userId}...`);

      // ⚡ 5. OPERACIÓN ATÓMICA: Inyectamos MONEDAS, no dólares.
      await prisma.$transaction([
        prisma.wallet.upsert({
          where: { userId: userId },
          update: { coinBalance: { increment: coinsToAdd } }, // 🔥 MAGIA: Aumenta las Monedas
          create: { userId: userId, balance: 0, pendingBalance: 0, coinBalance: coinsToAdd }
        }),
        prisma.transaction.create({
          data: {
            amount: amountReal,       // Guardamos cuánto pagó en USD ($10)
            netAmount: coinsToAdd,    // Guardamos cuántas monedas recibió (1050)
            platformFee: 0, 
            type: 'CREDIT_TOPUP',     // Tipo de Transacción: Recarga
            status: 'COMPLETED',
            senderId: userId, 
            receiverId: userId,
            attachedMessage: `Compra Cripto: Paquete de ${coinsToAdd} Monedas 🪙`,
            payramReceiptId: referenceId
          }
        })
      ]);

      console.log(`✅ ¡ÉXITO TOTAL! ${coinsToAdd} Monedas entregadas al Fan.`);
    }

  } catch (error) {
    console.error("❌ [CRITICAL] Error en el Webhook:", error.message);
  }
};