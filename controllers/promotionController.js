// backend/controllers/promotionController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.buyBoost = async (req, res) => {
  try {
    const userId = req.user.userId;
    // 🔥 1. Recibimos también los addons (extras) que envía el frontend
    const { packageId, addons } = req.body;

    // 2. Configurar precios y tiempos según el paquete
    let price = 0;
    let durationHours = 0;
    let promoType = '';

    if (packageId === 'basic') { price = 15; durationHours = 24; promoType = 'BASIC'; }
    else if (packageId === 'pro') { price = 25; durationHours = 48; promoType = 'PRO'; }
    else if (packageId === 'god') { price = 50; durationHours = 72; promoType = 'GOD'; }
    // 🔥 3. LA BALLENA: Paquete Leyenda (1 semana = 168 horas)
    else if (packageId === 'legend') { price = 100; durationHours = 168; promoType = 'LEGEND'; }
    else { return res.status(400).json({ error: 'Paquete inválido' }); }

    // 🔥 4. SUMAR EL COSTO DEL UPSELL (Borde de Fuego)
    const wantsFire = addons && addons.includes('FIRE_BORDER');
    if (wantsFire) {
      price += 5; // Le sumamos $5 al total
    }

    // 5. Verificar el saldo del creador en la base de datos
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    
    if (!wallet || wallet.balance < price) {
      return res.status(400).json({ error: `Saldo insuficiente. Tienes $${wallet?.balance?.toFixed(2) || 0}, necesitas $${price}.` });
    }

    // 6. Ejecutar la compra (Seguridad Transaccional)
    await prisma.$transaction(async (tx) => {
      
      // A) Descontar el dinero total de su billetera
      await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: price } }
      });

      // B) Registro contable
      await tx.transaction.create({
        data: {
          senderId: userId,
          receiverId: userId, // Queda en su historial
          type: 'PROMOTION',
          status: 'COMPLETED',
          amount: price, // Lo que pagó (incluyendo el fuego si lo compró)
          platformFee: price, // 🔥 EL 100% ES GANANCIA PURA PARA FANSMIO
          netAmount: 0, // El creador gana 0 con esto
          attachedMessage: `Compra de Fansmio Boost: ${promoType} ${wantsFire ? '+ Borde Animado' : ''}`
        }
      });

      // C) Activar la Promoción en el sistema
      const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
      
      // Desactivamos promociones anteriores si compra una nueva
      await tx.promotion.updateMany({
        where: { creatorId: userId, active: true },
        data: { active: false }
      });

      await tx.promotion.create({
        data: {
          creatorId: userId,
          package: promoType,
          expiresAt: expiresAt,
          active: true
        }
      });

      // 🔥 D) ACTIVAR EL FUEGO EN EL PERFIL
      // Actualizamos al usuario para indicarle al frontend que su foto debe arder
      if (wantsFire) {
        await tx.user.update({
          where: { id: userId },
          data: { hasFireBorder: true }
        });
      }
    });

    res.status(200).json({ message: '🚀 ¡Promoción activada! Ya eres VIP en el radar.' });

  } catch (error) {
    console.error('Error al comprar promoción:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar el pago.' });
  }
};

// 🔥 FUNCIÓN: Ver si el creador ya tiene un Boost activo
exports.getStatus = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const activePromo = await prisma.promotion.findFirst({
      where: { 
        creatorId: userId, 
        active: true,
        expiresAt: { gt: new Date() } // Que no haya expirado
      },
      orderBy: { expiresAt: 'desc' }
    });

    res.status(200).json({ active: !!activePromo, promotion: activePromo });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estado de promoción.' });
  }
};