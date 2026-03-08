// backend/limpiar.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function ejecutarLimpiezaForzada() {
  try {
    console.log("🔥 Iniciando eliminación forzada...");

    // Buscamos a lopez@test.com o cualquier usuario que NO sea ADMIN
    const usuariosMalos = await prisma.user.findMany({
      where: { role: { not: 'ADMIN' } }
    });

    if (usuariosMalos.length === 0) {
        console.log("✅ No hay usuarios de prueba para borrar. Tu base de datos está limpia.");
        return;
    }

    // Borramos a la fuerza sus datos conectados primero para que la BD no se trabe
    for (const user of usuariosMalos) {
      console.log(`💀 Destruyendo cuenta y datos de: ${user.email}...`);

      // 1. Destruimos su Perfil, Billetera y Sesiones abiertas
      await prisma.creatorProfile.deleteMany({ where: { userId: user.id } });
      await prisma.wallet.deleteMany({ where: { userId: user.id } });
      await prisma.session.deleteMany({ where: { userId: user.id } });

      // 2. Finalmente, le damos el golpe de gracia al usuario
      await prisma.user.delete({ where: { id: user.id } });
      
      console.log(`✅ ¡${user.email} exterminado por completo!`);
    }

    console.log("👑 Limpieza terminada. ¡Solo el ADMIN vive!");

  } catch (error) {
    console.error("❌ Error en la limpieza:", error);
  } finally {
    await prisma.$disconnect();
  }
}

ejecutarLimpiezaForzada();