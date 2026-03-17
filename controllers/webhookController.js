// backend/controllers/webhookController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * 📢 NOTA PARA EL JEFE: 
 * Con PayRam, la lógica de activación de suscripciones y pagos ya no sucede aquí.
 * Ahora sucede instantáneamente en 'paymentController.js'.
 * Este archivo queda reservado solo para webhooks de infraestructura externa.
 */

// ==========================================
// 🎥 EJEMPLO: WEBHOOK DE INFRAESTRUCTURA (Opcional)
// ==========================================
exports.handleGeneralWebhook = async (req, res) => {
  try {
    // Aquí podrías manejar alertas de servidores, logs externos, etc.
    console.log("📡 Webhook de infraestructura recibido:", req.body);
    
    res.status(200).send('OK');
  } catch (error) {
    console.error("❌ Error en Webhook General:", error);
    res.status(500).send('Internal Error');
  }
};

/**
 * 🗑️ ELIMINADO: handleNowPaymentsWebhook
 * Razón: PayRam procesa los pagos en tiempo real. No más esperas.
 */