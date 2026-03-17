const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const { sendNotificationEmail } = require('../utils/emailService');
const { sendPushNotification } = require('../utils/pushService');

// ==========================================
// 🏦 MOTOR PAYRAM: PROCESADOR INSTANTÁNEO
// ==========================================
exports.createPaymentIntent = async (req, res) => {
  try {
    const { amount, type, description, couponCode, creatorId, postId, bundleId, messageId, attachedMessage } = req.body; 
    const fanId = req.user.userId;
    
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });

    let finalAmount = parseFloat(amount);
    let appliedCouponId = null;

    // 🎟️ LÓGICA DE CUPONES
    if (couponCode && creatorId && type !== 'TIP') {
      const coupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
      if (coupon && coupon.creatorId === creatorId && coupon.active) {
        const isNotExpired = !coupon.expiresAt || new Date() <= new Date(coupon.expiresAt);
        const hasUsesLeft = !coupon.maxUses || coupon.currentUses < coupon.maxUses;
        if (isNotExpired && hasUsesLeft) {
          finalAmount = finalAmount - ((finalAmount * coupon.discountPercent) / 100);
          appliedCouponId = coupon.id;
          await prisma.coupon.update({ where: { id: coupon.id }, data: { currentUses: { increment: 1 } } });
        }
      }
    }

    if (finalAmount < 0.50) finalAmount = 0.50;

    // 🏦 REGLAS DE COMISIÓN (20% por defecto, 30% en Live)
    let feePercent = (type === 'LIVE_TICKET' || type === 'PPV_LIVE') ? 0.30 : 0.20;
    const platformFee = finalAmount * feePercent; 
    const netAmount = finalAmount - platformFee;

    // Generación de Recibo Único de PayRam
    const payramReceiptId = `PAYRAM-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

    // 🛡️ TRANSACCIÓN ATÓMICA
    await prisma.$transaction(async (db) => {
      // 1. Crear registro contable completado
      const tx = await db.transaction.create({
        data: {
          senderId: fanId,
          receiverId: creatorId,
          type,
          status: 'COMPLETED',
          amount: finalAmount,
          platformFee,
          netAmount,
          postId,
          bundleId,
          attachedMessage: messageId || attachedMessage,
          payramReceiptId
        }
      });

      // 2. Cargar billetera del creador (Saldo Pendiente)
      await db.wallet.upsert({
        where: { userId: creatorId },
        update: { pendingBalance: { increment: netAmount } },
        create: { userId: creatorId, pendingBalance: netAmount }
      });

      // 3. Activación de Producto según tipo
      if (type === 'SUBSCRIPTION') {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        await db.subscription.upsert({
          where: { fanId_creatorId: { fanId, creatorId } },
          update: { status: 'ACTIVE', endDate },
          create: { fanId, creatorId, status: 'ACTIVE', price: finalAmount, endDate }
        });
      } else if (type === 'PPV_POST') {
        await db.postPurchase.create({ data: { fanId, postId, pricePaid: finalAmount } });
      }
      // (Añade aquí el resto de tus activaciones: Bundle, Tips, etc.)
    });

    res.status(200).json({ success: true, message: 'Procesado por PayRam', receipt: payramReceiptId });

  } catch (error) {
    console.error("Error PayRam:", error);
    res.status(500).json({ error: 'Error en el motor de pagos interno.' });
  }
};

exports.getMySubscriptions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const subscriptions = await prisma.subscription.findMany({
      where: { fanId: userId },
      include: { creator: { select: { username: true, creatorProfile: { select: { profileImage: true } } } } }
    });
    res.status(200).json({ subscriptions });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener suscripciones.' });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    const { creatorId } = req.body;
    await prisma.subscription.updateMany({
      where: { fanId: req.user.userId, creatorId, status: 'ACTIVE' },
      data: { status: 'CANCELED' }
    });
    res.status(200).json({ message: 'Suscripción cancelada.' });
  } catch (error) {
    res.status(500).json({ error: 'Error al cancelar suscripción.' });
  }
};