// backend/utils/payramService.js
const crypto = require('crypto');

/**
 * 🏦 PAYRAM CORE SERVICE
 * Este servicio maneja la lógica auxiliar de tu propia plataforma de pagos.
 * Siguiendo el Plan Maestro, aquí se integrarán las llamadas a la API de PayRam
 * cuando la plataforma independiente esté lista.
 */

/**
 * Genera un recibo único y rastreable para PayRam (Ledger)
 * @returns {string} - ID de recibo único
 */
exports.generatePayramReceipt = () => {
  const prefix = 'PAYRAM';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Valida si una transacción cumple con los requisitos mínimos de seguridad
 * @param {number} amount - Monto a procesar
 * @returns {boolean}
 */
exports.validateTransactionSafety = (amount) => {
  // Regla básica: No procesar nada menor a 0.50 USD para evitar spam de micro-transacciones
  return amount >= 0.50;
};

/**
 * 💸 MOTOR DE RETIROS (PAYOUTS) - MODO PAYRAM MVP
 * En esta fase, los retiros se gestionan manualmente para control total.
 * Esta función prepara la notificación y el rastro contable.
 */
exports.prepareManualPayout = async (address, amount) => {
  try {
    console.log(`[PAYRAM] Preparando rastro para retiro manual: $${amount} a la dirección ${address}`);
    
    // Generamos un ID de seguimiento interno para que el admin lo use en Binance
    return {
      trackingId: `WD-${Date.now()}`,
      status: "AWAITING_MANUAL_TRANSFER",
      network: "USDT_TRC20"
    };
  } catch (error) {
    console.error("❌ Error en PayRam Service:", error.message);
    throw new Error("Error interno en el servicio de PayRam.");
  }
};