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

    // 2. Respuesta rápida
    res.status(200).send('OK');

    const status = payload.status?.toUpperCase(); 
    const amountReal = parseFloat(payload.filled_amount_in_usd || payload.amount || 0); 
    const userId = payload.customer_id; 
    const referenceId = payload.invoice_id || payload.reference_id || payload.id;

    console.log(`📡 [COVRA RADAR] Recibido: ${status} | Monto Pagado: $${amountReal}`);

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

      // 🎁 4. ESCÁNER INTELIGENTE DE PAQUETES Y BONOS
      // Base: $1 USD = 100 Monedas
      let coinsToAdd = Math.floor(amountReal * 100); 

      // Ajustamos los Bonos Gratis según tu Tienda:
      if (amountReal === 10) coinsToAdd = 1050;  // Saco (+50 Gratis)
      if (amountReal === 50) coinsToAdd = 5500;  // Cofre (+500 Gratis)
      if (amountReal === 90) coinsToAdd = 11500; // Bóveda (+1500 Gratis)

      console.log(`🪙 Acreditando ${coinsToAdd} MONEDAS a la Bóveda del usuario ${userId}...`);

      // ⚡ 5. OPERACIÓN ATÓMICA
      await prisma.$transaction([
        prisma.wallet.upsert({
          where: { userId: userId },
          update: { coinBalance: { increment: coinsToAdd } }, 
          create: { userId: userId, balance: 0, pendingBalance: 0, coinBalance: coinsToAdd }
        }),
        prisma.transaction.create({
          data: {
            amount: amountReal,       // Lo que pagó en Dólares ($)
            netAmount: coinsToAdd,    // Lo que recibió en Monedas (🪙)
            platformFee: 0, 
            type: 'CREDIT_TOPUP',     
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