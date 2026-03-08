// backend/controllers/promotionController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.buyBoost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { packageId } = req.body;

    // 1. Configurar precios y tiempos según el paquete
    let price = 0;
    let durationHours = 0;
    let promoType = '';

    if (packageId === 'basic') { price = 15; durationHours = 24; promoType = 'BASIC'; }
    else if (packageId === 'pro') { price = 25; durationHours = 48; promoType = 'PRO'; }
    else if (packageId === 'god') { price = 50; durationHours = 72; promoType = 'GOD'; }
    else { return res.status(400).json({ error: 'Paquete inválido' }); }

    // 2. Verificar el saldo del creador en la base de datos
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    
    if (!wallet || wallet.balance < price) {
      return res.status(400).json({ error: `Saldo insuficiente. Tienes $${wallet?.balance?.toFixed(2) || 0}, necesitas $${price}.` });
    }

    // 3. Ejecutar la compra (Seguridad Transaccional)
    await prisma.$transaction(async (tx) => {
      
      // A) Descontar el dinero de su billetera
      await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: price } }
      });

      // B) Registro contable
      await tx.transaction.create({
        data: {
          senderId: userId,
          receiverId: userId, // Es un pago a la plataforma
          type: 'PROMOTION',
          status: 'COMPLETED',
          amount: price,
          platformFee: 0,
          netAmount: price,
          attachedMessage: `Compra de Fansmios Boost: ${promoType}`
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
    });

    res.status(200).json({ message: '🚀 ¡Promoción activada! Ya eres VIP en el radar.' });

  } catch (error) {
    console.error('Error al comprar promoción:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar el pago.' });
  }
};

// 🔥 NUEVA FUNCIÓN: Ver si el creador ya tiene un Boost activo
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