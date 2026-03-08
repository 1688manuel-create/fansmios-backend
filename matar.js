// backend/matar.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function orden66() {
  try {
    const emailMaldito = "lopez@test.com"; // El usuario que se niega a morir
    console.log(`💀 Iniciando Orden 66 contra: ${emailMaldito}...`);

    const user = await prisma.user.findUnique({ where: { email: emailMaldito } });
    
    if (!user) {
      console.log("✅ ¡El usuario ya no existe en la base de datos!");
      return;
    }

    // 1. Destruimos sus defensas (Todo lo que podría estar atado a él)
    console.log("🧨 Destruyendo billeteras, perfiles y cupones...");
    await prisma.creatorProfile.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.deleteMany({ where: { userId: user.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.coupon.deleteMany({ where: { creatorId: user.id } });
    await prisma.post.deleteMany({ where: { userId: user.id } });

    // 2. El golpe final
    await prisma.user.delete({ where: { email: emailMaldito } });
    
    console.log(`👑 ¡Misión Cumplida! ${emailMaldito} ha sido borrado de la faz de la tierra.`);

  } catch (error) {
    console.error("❌ El escudo resistió. Aquí está el error real del motor:", error);
  } finally {
    await prisma.$disconnect();
  }
}

orden66();