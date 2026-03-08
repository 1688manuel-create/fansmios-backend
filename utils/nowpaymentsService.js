// backend/utils/nowpaymentsService.js
const axios = require('axios');

const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const API_URL = 'https://api.nowpayments.io/v1';

/**
 * Crea una orden de pago en NOWPayments
 * @param {number} amountInUsd - Cantidad en USD (Ej: 10.50)
 * @param {string} orderId - ID interno de nuestra BD (Ej: ID de la Transaction)
 * @param {string} orderDescription - Ej: "Suscripción VIP - @creador"
 * @returns {Object} - Datos del pago (pay_address, payment_id, etc.)
 */
exports.createCryptoPayment = async (amountInUsd, orderId, orderDescription) => {
  try {
    const response = await axios.post(
      `${API_URL}/payment`,
      {
        price_amount: amountInUsd,
        price_currency: 'usd', // Siempre calculamos en Dólares
        pay_currency: 'usdttrc20', // Obligamos a que la red subyacente sea USDT Tron (Comisiones de $0.50 céntimos)
        order_id: orderId, // Para rastrearlo en nuestro Webhook
        order_description: orderDescription,
        ipn_callback_url: `${process.env.BACKEND_URL}/api/payments/webhook`, // A dónde nos avisará que ya pagaron
      },
      {
        headers: {
          'x-api-key': NOWPAYMENTS_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error('❌ Error en NOWPayments API:', error.response?.data || error.message);
    throw new Error('Error al conectar con la pasarela de pagos descentralizada.');
  }
};

// ... (tu código anterior de createCryptoPayment se queda arriba) ...

// ==========================================
// 💸 MOTOR DE PAYOUTS AUTOMÁTICOS (FASE 6)
// ==========================================
exports.sendCryptoPayout = async (address, amount) => {
  try {
    // 🛑 IMPORTANTE: Si no tienes las credenciales de retiro aún, simulamos el éxito.
    if (!process.env.NOWPAYMENTS_EMAIL || !process.env.NOWPAYMENTS_PASSWORD) {
      console.log(`⚠️ MODO SIMULACIÓN: Enviando $${amount} USDT a ${address}...`);
      return { id: `sim_payout_${Date.now()}`, status: "FINISHED" };
    }

    // 1. NOWPayments requiere que nos autentiquemos con email y contraseña para mover dinero
    const authRes = await axios.post('https://api.nowpayments.io/v1/auth', {
      email: process.env.NOWPAYMENTS_EMAIL,
      password: process.env.NOWPAYMENTS_PASSWORD
    });
    
    const token = authRes.data.token;

    // 2. Ejecutamos el envío masivo (en este caso, 1 solo creador a la vez)
    const payoutRes = await axios.post('https://api.nowpayments.io/v1/payout', {
      withdrawals: [
        {
          address: address,
          currency: 'usdttrc20', // Obligamos a Tron por rapidez y comisiones casi nulas
          amount: amount,
          ipn_callback_url: `${process.env.API_URL}/api/webhooks/payout` // Opcional
        }
      ]
    }, {
      headers: {
        'x-api-key': process.env.NOWPAYMENTS_API_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Devolvemos el recibo de la operación
    return payoutRes.data.withdrawals[0]; 
  } catch (error) {
    console.error("❌ Error en NOWPayments Payout:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Error al conectar con el banco Cripto para el retiro.");
  }
};