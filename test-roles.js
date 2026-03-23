// backend/test-roles.js

const probarCambioDeRol = async () => {
  try {
    console.log("1. Iniciando sesión como FAN para obtener el Gafete (Token)...");
    
    // Paso 1: Hacemos Login
    const loginResponse = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: "creador@fansmio.com", // El correo que registramos en el Módulo 1
        password: "PasswordSegura123!" // La contraseña que usamos
      })
    });

    const loginData = await loginResponse.json();

    if (!loginData.accessToken) {
      console.log("❌ Error en el login. Respuesta:", loginData);
      return; // Detenemos la prueba si falla el login
    }

    const miGafete = loginData.accessToken;
    console.log("✅ Login exitoso. Gafete obtenido.");

    // Paso 2: Usamos el Gafete para convertirnos en Creador
    console.log("\n2. Pidiendo al servidor convertirnos en CREADOR...");
    
    const roleResponse = await fetch('http://localhost:5000/api/users/become-creator', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${miGafete}` // 🛡️ ¡Aquí le mostramos el gafete al Guardia!
      }
    });

    const roleData = await roleResponse.json();
    
    console.log("\n=== RESPUESTA DEL SERVIDOR ===");
    console.log(roleData);
    console.log("==============================\n");

  } catch (error) {
    console.error("Error de conexión:", error);
  }
};

// Ejecutamos la función
probarCambioDeRol();