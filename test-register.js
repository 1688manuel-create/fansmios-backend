// backend/test-register.js (Lo estamos reusando para probar el login)

const probarLogin = async () => {
  console.log("Intentando Iniciar Sesión...");

  try {
    const response = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mi iPhone 15 Pro Max' // Simulamos que entramos desde un iPhone
      },
      body: JSON.stringify({
        email: "creador@fansmios.com", // El email que registramos antes
        password: "PasswordSegura123!" // La contraseña que pusimos
      })
    });

    const data = await response.json();
    
    console.log("\n=== RESPUESTA DEL LOGIN ===");
    console.log(data);
    console.log("===========================\n");

  } catch (error) {
    console.error("Error conectando al servidor:", error);
  }
};

probarLogin();