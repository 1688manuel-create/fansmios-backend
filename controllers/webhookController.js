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
      // 🎁 4. ESCÁNER INTELIGENTE (TOLERANCIA CRIPTO)
      // ========================================================
      
      // Paso A: Convertimos cada centavo real a monedas (Ej: $9.85 = 985 monedas)
      let baseCoins = Math.floor(amountReal * 100); 
      let bonusCoins = 0;

      // Paso B: Detectamos qué paquete intentó comprar usando un margen de tolerancia (± 15%)
      if (amountReal >= 8.50 && amountReal <= 11.50) {
        bonusCoins = 50;     // Detectó paquete "Saco". Bono de +50
      } 
      else if (amountReal >= 42.00 && amountReal <= 58.00) {
        bonusCoins = 500;    // Detectó paquete "Cofre". Bono de +500
      } 
      else if (amountReal >= 78.00 && amountReal <= 102.00) {
        bonusCoins = 1500;   // Detectó paquete "Bóveda". Bono de +1500
      }

      // Paso C: Suma final exacta
      const coinsToAdd = baseCoins + bonusCoins;

      console.log(`🪙 Base: ${baseCoins} + Bono: ${bonusCoins} = Acreditando ${coinsToAdd} MONEDAS a ${userId}...`);

      // ========================================================

      // ⚡ 5. OPERACIÓN ATÓMICA
      await prisma.$transaction([
        prisma.wallet.upsert({
          where: { userId: userId },
          update: { coinBalance: { increment: coinsToAdd } }, 
          create: { userId: userId, balance: 0, pendingBalance: 0, coinBalance: coinsToAdd }
        }),
        prisma.transaction.create({
          data: {
            amount: amountReal,       // Registramos el dólar exacto que ingresó ($9.85)
            netAmount: coinsToAdd,    // Registramos las monedas exactas entregadas (1035 🪙)
            platformFee: 0, 
            type: 'CREDIT_TOPUP',     
            status: 'COMPLETED',
            senderId: userId, 
            receiverId: userId,
            attachedMessage: `Compra Cripto: Recarga de ${coinsToAdd} Monedas 🪙`,
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