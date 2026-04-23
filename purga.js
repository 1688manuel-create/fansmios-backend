// backend/purga.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function purgaTotal() {
  console.log("🔥 INICIANDO PROTOCOLO TABULA RASA DEFINITIVO 🔥");
  
  try {
    // 1. Identificamos a los intrusos (Cualquiera que NO sea ADMIN)
    const usuarios = await prisma.user.findMany({
      where: { role: { not: 'ADMIN' } },
      select: { id: true }
    });
    
    const ids = usuarios.map(u => u.id);

    if (ids.length === 0) {
      console.log("✅ La plataforma ya está limpia. Solo queda el ADMIN.");
      return;
    }

    console.log(`💀 Exterminando ${ids.length} usuarios de prueba y sus rastros...`);

    // 2. Destruimos sus dependencias (Finanzas, Contenido, Perfiles)
    console.log("🧨 Cortando conexiones de bases de datos...");
    
    // A. Finanzas y Notificaciones
    await prisma.transaction.deleteMany({ 
      where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } 
    });
    await prisma.subscription.deleteMany({ 
        where: { OR: [{ fanId: { in: ids } }, { creatorId: { in: ids } }] } 
    });
    await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });

    // B. Contenido, Perfiles y Sesiones (Heredado de la Orden 66)
    // Usamos catch por si alguna tabla no existe o ya está vacía, que no detenga la purga
    try { await prisma.postPurchase.deleteMany({ where: { fanId: { in: ids } } }); } catch(e){}
    try { await prisma.post.deleteMany({ where: { userId: { in: ids } } }); } catch(e){}
    try { await prisma.coupon.deleteMany({ where: { creatorId: { in: ids } } }); } catch(e){}
    try { await prisma.creatorProfile.deleteMany({ where: { userId: { in: ids } } }); } catch(e){}
    try { await prisma.session.deleteMany({ where: { userId: { in: ids } } }); } catch(e){}

    // 3. El golpe final: Borramos a los usuarios
    await prisma.user.deleteMany({ where: { id: { in: ids } } });

    console.log("👑 ¡BOMBA DETONADA CON ÉXITO! Terreno despejado. El MVP de Fansmios está impecable.");

  } catch (error) {
    console.error("🚨 ERROR DURANTE LA PURGA (El escudo resistió):", error);
  } finally {
    await prisma.$disconnect();
  }
}

purgaTotal();