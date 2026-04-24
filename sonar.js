// sonar.js - Disparo de prueba al Webhook
async function probarRadar() {
  console.log("🚀 Disparando misil de prueba al servidor...");
  
  try {
    // Reemplaza la KEY con la tuya real si es diferente
    const url = 'https://api.fansmio.com/api/webhooks/payram?key=2a0b3a5c98e7b3bb6ec52df6189c3e1d';
    
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceId: "PRUEBA-FANTASMA-123",
        status: "PAID"
      })
    });

    const texto = await respuesta.text();
    console.log(`\n🎯 IMPACTO - Código de respuesta: ${respuesta.status}`);
    console.log(`📝 Mensaje del servidor:`, texto.substring(0, 150));

  } catch (error) {
    console.error("❌ Error de red:", error);
  }
}

probarRadar();