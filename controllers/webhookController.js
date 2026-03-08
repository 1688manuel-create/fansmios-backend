// backend/controllers/webhookController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const { sendNotificationEmail } = require('../utils/emailService');
const { sendPushNotification } = require('../utils/pushService');

exports.handleNowPaymentsWebhook = async (req, res) => {
  try {
    const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
    const signature = req.headers['x-nowpayments-sig'];
    
    // 🛡️ SEGURIDAD: Validamos que el mensaje viene 100% de NOWPayments usando tu llave secreta
    const hmac = crypto.createHmac('sha512', ipnSecret);
    hmac.update(JSON.stringify(req.body, Object.keys(req.body).sort()));
    const calculatedSignature = hmac.digest('hex');

    if (signature !== calculatedSignature) {
      console.error('🚨 [FRAUDE] Firma de Webhook inválida. Alguien intentó simular un pago.');
      return res.status(401).send('Firma inválida');
    }

    const paymentStatus = req.body.payment_status; // 'finished', 'failed', 'refunded'...
    const orderId = req.body.order_id; // Este es el ID de nuestra Transacción en PostgreSQL

    // 📡 Escuchamos el aviso de que el dinero ya está seguro en tu Bóveda
    if (paymentStatus === 'finished') {
      
      const tx = await prisma.transaction.findUnique({ 
        where: { id: orderId },
        include: { sender: true, receiver: true } 
      });

      if (!tx || tx.status === 'COMPLETED') {
        return res.status(200).json({ message: 'Pago ya procesado anteriormente' });
      }

      console.log(`💰 ¡DINERO RECIBIDO! Pago híbrido de $${tx.amount} procesado con éxito.`);

      // 🏦 Transacción ACID de Base de Datos
      await prisma.$transaction(async (db) => {
        // 1. Marcar transacción como exitosa
        await db.transaction.update({
          where: { id: tx.id },
          data: { status: 'COMPLETED' }
        });

        // 2. Enviar la ganancia neta a la PENDING WALLET del creador
        const existingWallet = await db.wallet.findUnique({ where: { userId: tx.receiverId } });
        if (existingWallet) {
          await db.wallet.update({
            where: { userId: tx.receiverId },
            data: { pendingBalance: { increment: tx.netAmount } }
          });
        } else {
          await db.wallet.create({
            data: { userId: tx.receiverId, balance: 0.0, pendingBalance: tx.netAmount }
          });
        }

        // 3. ACTIVAR EL CONTENIDO SEGÚN LO QUE COMPRÓ
        const fan = tx.sender;
        const creator = tx.receiver;

        if (tx.type === 'SUBSCRIPTION') {
          const newEndDate = new Date();
          newEndDate.setDate(newEndDate.getDate() + 30); // Suscripción ética de 30 días
          
          const existingSub = await db.subscription.findFirst({ where: { fanId: fan.id, creatorId: creator.id } });
          if (existingSub) {
            await db.subscription.update({
              where: { id: existingSub.id },
              data: { status: 'ACTIVE', endDate: newEndDate, reminderSent: false }
            });
          } else {
            await db.subscription.create({
              data: { fanId: fan.id, creatorId: creator.id, status: 'ACTIVE', price: tx.amount, endDate: newEndDate }
            });
          }
          await sendNotificationEmail(creator.id, 'sale', '⭐ ¡Nuevo Suscriptor VIP!', `<b>@${fan.username}</b> activó su VIP.`);
          await sendPushNotification(creator.id, '⭐ ¡Nuevo VIP!', `@${fan.username} se suscribió.`, `http://localhost:3000/${creator.username}`);
        }
        else if (tx.type === 'TIP') {
          await sendNotificationEmail(creator.id, 'sale', '💸 ¡Nueva Propina!', `<b>@${fan.username}</b> te envió $${tx.netAmount.toFixed(2)} USD.`);
        }
        else if (tx.type === 'PPV_POST') {
          await db.postPurchase.create({ data: { fanId: fan.id, postId: tx.postId, pricePaid: tx.amount } });
          await sendNotificationEmail(creator.id, 'sale', '🔓 ¡Post Desbloqueado!', `<b>@${fan.username}</b> compró tu PPV.`);
        }
        // (Agrega aquí BUNDLE o PPV_MESSAGE si lo deseas, sigue la misma lógica)
      });
    } 
    else if (paymentStatus === 'failed' || paymentStatus === 'refunded') {
      await prisma.transaction.update({ where: { id: orderId }, data: { status: 'FAILED' } });
      console.log(`❌ Pago fallido o reembolsado para la orden: ${orderId}`);
    }

    // Le respondemos al banco: "Mensaje recibido fuerte y claro"
    res.status(200).send('OK');
  } catch (error) {
    console.error("❌ Error grave en Webhook:", error);
    res.status(500).send('Webhook Error');
  }
};