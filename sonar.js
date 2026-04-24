// sonar.js - Operación Rescate de Fondos
async function probarRadar() {
  console.log("🚀 Disparando misil de rescate al servidor...");
  
  try {
    const url = 'https://api.fansmio.com/api/webhooks/payram?key=2a0b3a5c98e7b3bb6ec52df6189c3e1d';
    
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 🔥 ESTE ES EL ID EXACTO DE TU ÚLTIMO PAGO REAL:
        referenceId: "be718b71-ce82-4086-84df-cc41a200516f",
        status: "OVER_FILLED",
        filled_amount_in_usd: "1.018232"
      })
    });

    const texto = await respuesta.text();
    console.log(`\n🎯 IMPACTO - Código de respuesta: ${respuesta.status}`);
    console.log(`📝 Mensaje del servidor:`, texto);

  } catch (error) {
    console.error("❌ Error de red:", error);
  }
}

probarRadar();