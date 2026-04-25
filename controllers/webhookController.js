const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.handlePayRamWebhook = async (req, res) => {
  try {
    // 🔐 1. VALIDACIÓN POR LLAVE (La que sale en tu captura)
    // Extraemos la key de la URL (?key=...)
    const { key } = req.query; 
    if (key !== process.env.PAYRAM_API_KEY) {
      console.log("❌ [SECURITY] Intento de acceso no autorizado. Key inválida.");
      return res.status(401).send('Unauthorized');
    }

    const payload = req.body;

    // 🧪 2. EXTRACCIÓN DE DATOS (Anti-Volatilidad)
    // Aceptamos el monto real que llegó, aunque sean centavos de más o de menos
    const amountReal = Number(payload.filled_amount_in_usd || payload.amount || 0);
    const userId = payload.customer_id;
    const referenceId = payload.invoice_id || payload.reference_id;
    const status = payload.status?.toUpperCase();

    // 🛡️ 3. FILTRO DE ESTADOS (Tolerancia Total)
    const estadosExitosos = new Set(['FILLED', 'OVER_FILLED', 'PARTIALLY_FILLED', 'COMPLETED', 'SUCCESS']);

    if (!estadosExitosos.has(status)) {
      console.log(`⏳ [INFO] Pago en proceso o ignorado: ${status}`);
      return res.status(200).send('Ignored');
    }

    if (!userId || amountReal <= 0) {
      console.log("❌ [VALIDATION] Datos de usuario o monto inválidos");
      return res.status(400).send('Invalid data');
    }

    // ⚡ 4. RESPUESTA RÁPIDA A LA PASARELA
    res.status(200).send('OK');

    // ⚡ 5. TRANSACCIÓN ATÓMICA (Inyectar saldo + Crear Historial)
    try {
      await prisma.$transaction(async (tx) => {
        
        // 💰 Actualizar o Crear Billetera (Upsert)
        await tx.wallet.upsert({
          where: { userId },
          update: { balance: { increment: amountReal } },
          create: { userId, balance: amountReal }
        });

        // 🧾 Crear el Recibo en el Historial (Evita duplicados por payramReceiptId)
        await tx.transaction.create({
          data: {
            amount: amountReal,
            netAmount: amountReal,
            platformFee: 0,
            type: 'CREDIT_TOPUP',
            status: 'COMPLETED',
            senderId: userId,
            receiverId: userId,
            description: `Recarga via Covra Pay (Monto: $${amountReal})`,
            payramReceiptId: referenceId
          }
        });
      });

      console.log(`✅ [SUCCESS] $${amountReal} acreditados y enlazados al usuario ${userId}`);

    } catch (err) {
      // Si el error es P2002, significa que ya registramos este pago (Idempotencia)
      if (err.code === 'P2002') {
        console.log("⚠️ [DUPLICATE] Este pago ya estaba registrado en el historial.");
        return;
      }
      throw err; // Si es otro error, que lo atrape el catch de afuera
    }

  } catch (error) {
    console.error("❌ [CRITICAL_ERROR] Error en el radar de Webhooks:", error.message);
  }
};