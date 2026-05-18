// backend/controllers/paymentController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const axios = require('axios'); // <-- NECESARIO PARA LLAMAR A PAYRAM
const { sendNotificationEmail } = require('../utils/emailService');
const { sendPushNotification } = require('../utils/pushService');

// ==========================================
// 🏦 MOTOR COVRA: PROCESADOR INTERNO DE FANSMIOS
// Version: 2.1 - Producción (Corregida)
// ==========================================

exports.createPaymentIntent = async (req, res) => {
  try {
    let { 
      amount, type, description, couponCode, creatorId, 
      postId, bundleId, messageId, attachedMessage 
    } = req.body;
    
    const fanId = req.user.userId;

    // Normalización de tipos de PPV
    if (type === 'POST') type = 'PPV_POST';
    if (type === 'MESSAGE') type = 'PPV_MESSAGE';
    
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });

    let finalAmount = parseFloat(amount);
    let appliedCouponId = null;

    // 1️⃣ PRE-VALIDACIÓN DE CUPONES (Solo lectura)
    if (couponCode && creatorId && type !== 'TIP') {
      const coupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
      if (coupon && coupon.creatorId === creatorId && coupon.active) {
        const isNotExpired = !coupon.expiresAt || new Date() <= new Date(coupon.expiresAt);
        const hasUsesLeft = !coupon.maxUses || coupon.currentUses < coupon.maxUses;
        if (isNotExpired && hasUsesLeft) {
          finalAmount = finalAmount - ((finalAmount * coupon.discountPercent) / 100);
          appliedCouponId = coupon.id;
        }
      }
    }

    if (finalAmount <= 0) return res.status(400).json({ error: 'El monto final debe ser mayor a 0.' });

    // 2️⃣ CÁLCULO DE COMISIONES (MODO DIOS)
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } }) || 
                     { feeLive: 30, feeSubscription: 20, feeTips: 20, feePPV: 20, feeReferral: 5 };
    
    let feePercent = 0.20; 
    if (type === 'LIVE_TICKET' || type === 'PPV_LIVE') {
      feePercent = settings.feeLive / 100;
    } else if (type === 'SUBSCRIPTION') {
      feePercent = settings.feeSubscription / 100;
    } else if (type === 'TIP') {
      feePercent = settings.feeTips / 100;
    } else if (type === 'CREDIT_TOPUP') {
      feePercent = 0; 
    } else {
      feePercent = settings.feePPV / 100; 
    }

    const platformFee = finalAmount * feePercent; 
    const netAmount = finalAmount - platformFee;
    const internalReceiptId = `FSM-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

    const fan = await prisma.user.findUnique({ where: { id: fanId }, select: { username: true, email: true } });

    // ==========================================
    // 💳 RUTA 1: RECARGA EXTERNA (PAYRAM / COVRA PAY)
    // ==========================================
    if (type === 'CREDIT_TOPUP') {
      const payramResponse = await axios.post(`${process.env.PAYRAM_BASE_URL}/api/v1/payment`, {
        customerEmail: fan.email,     
        customerID: fanId.toString(), 
        amountInUSD: finalAmount      
      }, {
        headers: {
          'API-Key': process.env.PAYRAM_API_KEY, 
          'Content-Type': 'application/json'
        }
      });

      const checkoutUrl = payramResponse.data.url;
      if (!checkoutUrl) throw new Error("Covra Pay no devolvió una URL válida.");

      return res.status(200).json({ success: true, checkoutUrl });

    } else {
      // ==========================================
      // 🛍️ RUTA 2: PAGOS INTERNOS (Billetera a Billetera)
      // ==========================================
      const targetMessageId = messageId || attachedMessage;

      // 🔥 TRANSACCIÓN ATÓMICA: Todo sucede o nada sucede
      await prisma.$transaction(async (db) => {
        
        // A. Validar Saldo
        const fanWallet = await db.wallet.findUnique({ where: { userId: fanId } });
        if (!fanWallet || fanWallet.balance < finalAmount) {
          throw new Error("Saldo insuficiente en tu Bóveda de FansMio.");
        }
        
        // B. Descontar Saldo del Fan
        await db.wallet.update({
          where: { userId: fanId },
          data: { balance: { decrement: finalAmount } }
        });

        // C. Quemar Cupón (Solo si es válido y dentro de la transacción)
        if (appliedCouponId) {
          await db.coupon.update({
            where: { id: appliedCouponId },
            data: { currentUses: { increment: 1 } }
          });
        }

        // D. Registrar la Transacción en el Ledger
        await db.transaction.create({
          data: { 
            senderId: fanId, receiverId: creatorId, type, status: 'COMPLETED', 
            amount: finalAmount, platformFee, netAmount, postId, bundleId, 
            attachedMessage: targetMessageId, payramReceiptId: internalReceiptId 
          }
        });

        // E. Acreditar al Creador (Pending Balance)
        await db.wallet.upsert({
          where: { userId: creatorId },
          update: { pendingBalance: { increment: netAmount } },
          create: { userId: creatorId, balance: 0, pendingBalance: netAmount }
        });

        // F. MOTOR DE REFERIDOS (Solo para suscripciones nuevas)
        if (type === 'SUBSCRIPTION') {
          const creatorData = await db.user.findUnique({ 
            where: { id: creatorId }, select: { referredById: true, username: true, createdAt: true } 
          });
          
          if (creatorData?.referredById) {
            const expirationDate = new Date(creatorData.createdAt);
            expirationDate.setMonth(expirationDate.getMonth() + 5);

            if (new Date() <= expirationDate) {
              const referralBonus = finalAmount * ((settings.feeReferral || 5) / 100);

              await db.wallet.upsert({
                where: { userId: creatorData.referredById },
                update: { balance: { increment: referralBonus } },
                create: { userId: creatorData.referredById, balance: referralBonus }
              });

              await db.transaction.create({
                data: { 
                  senderId: creatorId, receiverId: creatorData.referredById, 
                  type: 'PROMOTION', status: 'COMPLETED', amount: referralBonus, 
                  netAmount: referralBonus, attachedMessage: `Comisión referido @${creatorData.username}`, 
                  payramReceiptId: `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
                }
              });

              await db.notification.create({
                data: {
                  userId: creatorData.referredById, type: 'MONEY',
                  content: `¡Dinero pasivo! 💸 Ganaste $${referralBonus.toFixed(2)} por referido @${creatorData.username}.`,
                  link: '/dashboard/referrals'
                }
              });
            }
          }
        }

        // G. DESBLOQUEO DE CONTENIDO Y NOTIFICACIONES
        let notificationMessage = '';
        let notificationType = 'MONEY';

        if (type === 'SUBSCRIPTION') {
          const endDate = new Date();
          endDate.setDate(endDate.getDate() + 30);
          await db.subscription.upsert({
            where: { fanId_creatorId: { fanId, creatorId } },
            update: { status: 'ACTIVE', endDate },
            create: { fanId, creatorId, status: 'ACTIVE', price: finalAmount, endDate }
          });
          notificationMessage = `¡Nuevo Suscriptor! @${fan.username} se suscribió por $${finalAmount}. 🎉`;
          notificationType = 'SUBSCRIPTION';

        } else if (type === 'PPV_POST') {
          await db.postPurchase.create({ data: { fanId, postId, pricePaid: finalAmount } });
          notificationMessage = `@${fan.username} desbloqueó un post PPV ($${finalAmount}). 🔓`;
          notificationType = 'PPV_SALE';

        } else if (type === 'PPV_MESSAGE') {
          if (!targetMessageId) throw new Error("ID de mensaje faltante.");
          await db.messagePurchase.create({ 
            data: { pricePaid: finalAmount, fan: { connect: { id: fanId } }, message: { connect: { id: targetMessageId } } } 
          });
          await db.message.update({ where: { id: targetMessageId }, data: { isUnlocked: true } });
          notificationMessage = `@${fan.username} desbloqueó un mensaje ($${finalAmount}). 💌`;
          notificationType = 'MESSAGE_SALE';

        } else if (type === 'BUNDLE') {
          const bundle = await db.bundle.findUnique({ where: { id: bundleId }, include: { posts: true } });
          await db.bundlePurchase.create({ data: { fanId, bundleId, pricePaid: finalAmount } });
          const postPurchases = bundle.posts.map(p => ({ fanId, postId: p.id, pricePaid: 0 }));
          await db.postPurchase.createMany({ data: postPurchases, skipDuplicates: true });
          notificationMessage = `@${fan.username} compró el paquete "${bundle.title}". 📦`;
          notificationType = 'BUNDLE_SALE';

        } else if (type === 'TIP') {
          notificationMessage = `¡Propina de $${finalAmount} de @${fan.username}! 💸 "${description || '¡Gracias!'}"`;
          notificationType = 'TIP';
        }

        // Notificar al Creador
        if (creatorId !== fanId) {
          await db.notification.create({
            data: { userId: creatorId, type: notificationType, content: notificationMessage, link: '/dashboard/wallet' }
          });
        }
      });

      return res.status(200).json({ 
        success: true, 
        message: 'Procesado con éxito', 
        receipt: internalReceiptId 
      });
    }

  } catch (error) {
    console.error("❌ ERROR MOTOR COVRA:", error.message);
    
    // Si es error de saldo insuficiente, enviamos 400 para que el frontend lo maneje
    const isClientError = error.message.includes("Saldo insuficiente") || error.message.includes("Monto");
    
    return res.status(isClientError ? 400 : 500).json({ 
      success: false, 
      error: error.message || 'Error interno en el procesador de pagos.' 
    });
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