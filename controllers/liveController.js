// backend/controllers/liveController.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto'); // Herramienta para crear códigos únicos

// ==========================================
// 1. INICIAR UNA NUEVA TRANSMISIÓN (Creador)
// ==========================================
exports.createLiveStream = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { title, isPPV, price } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'El en vivo necesita un título.' });
    }

    if (isPPV && (!price || price <= 0)) {
      return res.status(400).json({ error: 'Debes definir un precio válido para el PPV.' });
    }

    // Apagar cualquier stream viejo que se haya quedado prendido por error
    const activeStream = await prisma.liveStream.findFirst({
      where: { creatorId, status: { in: ['SCHEDULED', 'LIVE'] } }
    });

    if (activeStream) {
      await prisma.liveStream.update({
        where: { id: activeStream.id },
        data: { status: 'ENDED', endedAt: new Date() }
      });
    }

    // Crear una llave secreta súper rápida para LiveKit
    const superKey = crypto.randomBytes(8).toString('hex');

    // Crear la sala en la base de datos (Pura velocidad LiveKit)
    const newStream = await prisma.liveStream.create({
      data: {
        creatorId,
        title,
        isPPV: isPPV || false,
        price: isPPV ? parseFloat(price) : 0,
        status: 'SCHEDULED',
        streamKey: superKey,
      }
    });

    res.status(201).json({
      message: 'Sala de transmisión súper rápida creada ⚡',
      liveStream: newStream,
      streamId: newStream.id
    });

  } catch (error) {
    console.error('❌ Error al crear live stream:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// ==========================================
// 2. CAMBIAR ESTADO (Manual)
// ==========================================
exports.updateStreamStatus = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { streamId } = req.params;
    const { status } = req.body;

    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId }
    });

    if (!stream || stream.creatorId !== creatorId) {
      return res.status(403).json({ error: 'No tienes permiso sobre esta transmisión.' });
    }

    const updatedData = { status };
    if (status === 'LIVE') updatedData.startedAt = new Date();
    if (status === 'ENDED') updatedData.endedAt = new Date();

    const updatedStream = await prisma.liveStream.update({
      where: { id: streamId },
      data: updatedData
    });

    res.status(200).json({
      message: `El estado del stream ahora es: ${status} 📡`,
      updatedStream
    });

  } catch (error) {
    console.error('❌ Error al actualizar stream:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 3. OBTENER STREAM (🔥 LIMPIO, SIN MUX)
// ==========================================
exports.getLiveStream = async (req, res) => {
  try {
    const { streamId } = req.params;
    const fanId = req.user?.userId;

    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            creatorProfile: { select: { profileImage: true } }
          }
        },
        messages: {
          include: { user: { select: { username: true, role: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50 // Solo mandamos los últimos 50 para no saturar memoria
        }
      }
    });

    if (!stream) {
      return res.status(404).json({ error: 'Transmisión no encontrada o finalizada.' });
    }

    // 🛡️ REGLAS DE ACCESO (PAYWALL)
    let hasAccess = false;

    if (stream.creator.id === fanId || req.user?.role === 'ADMIN') {
      hasAccess = true; 
    } else if (stream.isPPV) {
      if (fanId) {
        const ticket = await prisma.transaction.findFirst({
          where: { senderId: fanId, postId: stream.id, type: 'LIVE_TICKET', status: 'COMPLETED' }
        });
        if (ticket) hasAccess = true; 
      }
    } else {
      hasAccess = true;
    }

    const responseStream = {
      ...stream,
      streamKey: stream.creator.id === fanId ? stream.streamKey : null,
      messages: hasAccess ? stream.messages.reverse() : [],
      playbackId: null, // Mux fue eliminado
      playbackToken: null
    };

    res.status(200).json({ hasAccess, stream: responseStream });

  } catch (error) {
    console.error('❌ Error al obtener stream:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 4. ENVIAR MENSAJE (API Fallback con Comisiones Dinámicas)
// ==========================================
exports.sendLiveMessage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { streamId, content, isDonation, amount } = req.body;

    if (!streamId || !content) return res.status(400).json({ error: 'Datos incompletos' });

    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      include: { creator: { include: { creatorProfile: true } } }
    });

    if (!stream) return res.status(404).json({ error: 'Stream no encontrado' });

    let fanLevel = 'NEW';
    if (userId !== stream.creatorId && req.user.role !== 'ADMIN') {
      const historicalSpends = await prisma.transaction.aggregate({
        where: { senderId: userId, receiverId: stream.creatorId, status: 'COMPLETED' },
        _sum: { amount: true }
      });
      const totalSpent = historicalSpends._sum.amount || 0;
      if (totalSpent >= 1000) fanLevel = 'DIAMOND';
      else if (totalSpent >= 500) fanLevel = 'GOLD';
      else if (totalSpent >= 100) fanLevel = 'SILVER';
      else if (totalSpent >= 10) fanLevel = 'BRONZE';
    } else if (userId === stream.creatorId) fanLevel = 'CREATOR';
    else if (req.user.role === 'ADMIN') fanLevel = 'ADMIN';

    // 🔥 COMISIONES DINÁMICAS (Si llega a entrar una donación por API en vez de Socket)
    if (isDonation && parseFloat(amount) > 0) {
      const tipAmount = parseFloat(amount);
      
      try {
        const globalSettings = await prisma.platformSetting.findFirst() || { feeTips: 20 };
        let feePercent = globalSettings.feeTips / 100;
        
        if (stream.creator?.creatorProfile?.customFeeTips != null) {
          feePercent = stream.creator.creatorProfile.customFeeTips / 100;
        }

        const feeAmount = tipAmount * feePercent;
        const netToCreator = tipAmount - feeAmount;

        await prisma.$transaction([
          prisma.wallet.upsert({ 
            where: { userId: stream.creatorId },
            update: { balance: { increment: netToCreator } },
            create: { userId: stream.creatorId, balance: netToCreator } 
          }),
          prisma.wallet.update({
            where: { userId: userId },
            data: { balance: { decrement: tipAmount } }
          }),
          prisma.transaction.create({
            data: {
              senderId: userId, receiverId: stream.creatorId,
              amount: tipAmount, platformFee: feeAmount, netAmount: netToCreator,
              type: 'TIP', status: 'COMPLETED', attachedMessage: content
            }
          })
        ]);
        console.log(`💰 API-TIP: $${tipAmount} USD a ${stream.creatorId}`);
      } catch (moneyError) {
        console.error('🚨 ERROR FINANCIERO API:', moneyError.message);
        return res.status(400).json({ error: 'Saldo insuficiente o error financiero.' });
      }
    }

    const newMessage = await prisma.liveChatMessage.create({
      data: {
        streamId, userId, content,
        isDonation: isDonation || false,
        amount: isDonation ? parseFloat(amount) : 0
      },
      include: { user: { select: { username: true, role: true } } }
    });

    res.status(201).json({ message: 'Mensaje enviado', chatMessage: { ...newMessage, fanLevel } });

  } catch (error) {
    console.error('❌ Error al enviar mensaje API:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ==========================================
// 5. OBTENER TRANSMISIONES ACTIVAS (FEED)
// ==========================================
exports.getFeedStreams = async (req, res) => {
  try {
    const activeStreams = await prisma.liveStream.findMany({
      where: { status: { not: 'ENDED' } },
      include: {
        creator: {
          select: {
            id: true, username: true,
            creatorProfile: { select: { profileImage: true, coverImage: true, category: true } }
          }
        },
        _count: { select: { messages: true } } 
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ activeStreams });
  } catch (error) {
    console.error('❌ Error al obtener streams activos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ==========================================
// 6. COMPRAR TICKET VIP AL INSTANTE (ONE-CLICK) 🔥 BLINDADO
// ==========================================
exports.buyLiveTicket = async (req, res) => {
  try {
    const fanId = req.user.userId;
    const { streamId, amount } = req.body;

    const stream = await prisma.liveStream.findUnique({ 
      where: { id: streamId },
      include: { creator: { include: { creatorProfile: true } } }
    });

    if (!stream) return res.status(404).json({ error: 'Transmisión no encontrada.' });
    if (stream.creatorId === fanId) return res.status(400).json({ error: 'No puedes comprarte un ticket a ti mismo.' });

    const fanWallet = await prisma.wallet.findUnique({ where: { userId: fanId } });
    if (!fanWallet || fanWallet.balance < amount) {
      return res.status(400).json({ error: 'Saldo insuficiente. Recarga tu Covra Wallet.' });
    }

    // 🔥 COMISIONES DINÁMICAS PARA ENTRADAS VIP
    const globalSettings = await prisma.platformSetting.findFirst() || { feePPV: 20 };
    let feePercent = globalSettings.feePPV / 100; // Asumimos que usas feePPV para accesos

    if (stream.creator?.creatorProfile?.customFeePPV != null) {
      feePercent = stream.creator.creatorProfile.customFeePPV / 100;
    }

    const feeAmount = amount * feePercent;
    const netAmount = amount - feeAmount;

    // Ejecutar transferencia atómica
    await prisma.$transaction([
      prisma.wallet.update({
        where: { userId: fanId },
        data: { balance: { decrement: amount } }
      }),
      prisma.wallet.upsert({
        where: { userId: stream.creatorId },
        update: { balance: { increment: netAmount } },
        create: { userId: stream.creatorId, balance: netAmount }
      }),
      prisma.transaction.create({
        data: {
          senderId: fanId,
          receiverId: stream.creatorId,
          amount: amount,
          platformFee: feeAmount,
          netAmount: netAmount,
          type: 'LIVE_TICKET',
          status: 'COMPLETED',
          postId: streamId
        }
      })
    ]);

    res.status(200).json({ success: true, message: '¡Ticket VIP Desbloqueado!' });

  } catch (error) {
    console.error('❌ Error al comprar ticket VIP:', error);
    res.status(500).json({ error: 'Error procesando el pago VIP.' });
  }
};

// ==========================================
// 🎯 FASE 1: MENÚ DE RETOS PRIVADOS
// ==========================================

// 1. Crear un nuevo reto (Solo Creador)
exports.createChallenge = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { title, description, price } = req.body;

    if (!title || !price || price <= 0) {
      return res.status(400).json({ error: 'Título y precio mayor a 0 son obligatorios.' });
    }

    const newChallenge = await prisma.liveChallenge.create({
      data: {
        creatorId,
        title,
        description,
        price: parseFloat(price),
        isActive: true
      }
    });

    res.status(201).json({ message: 'Reto creado con éxito 🎯', challenge: newChallenge });
  } catch (error) {
    console.error('❌ Error creando reto:', error);
    res.status(500).json({ error: 'Error interno al crear el reto.' });
  }
};

// 2. Obtener los retos activos de un creador (Público)
exports.getCreatorChallenges = async (req, res) => {
  try {
    const { creatorId } = req.params;
    const challenges = await prisma.liveChallenge.findMany({
      where: { creatorId, isActive: true },
      orderBy: { price: 'asc' } // Los ordenamos del más barato al más caro
    });
    res.status(200).json({ challenges });
  } catch (error) {
    console.error('❌ Error obteniendo retos:', error);
    res.status(500).json({ error: 'Error al obtener los retos.' });
  }
};

// 3. Apagar/Prender un reto (Solo Creador)
exports.toggleChallenge = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { challengeId } = req.params;
    const { isActive } = req.body;

    const challenge = await prisma.liveChallenge.findUnique({ where: { id: challengeId } });
    
    if (!challenge || challenge.creatorId !== creatorId) {
      return res.status(403).json({ error: 'No tienes permiso para modificar este reto.' });
    }

    const updated = await prisma.liveChallenge.update({
      where: { id: challengeId },
      data: { isActive }
    });

    res.status(200).json({ message: 'Estado del reto actualizado.', challenge: updated });
  } catch (error) {
    console.error('❌ Error actualizando reto:', error);
    res.status(500).json({ error: 'Error al modificar el reto.' });
  }
};

// 4. Eliminar reto para siempre (Solo Creador)
exports.deleteChallenge = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { challengeId } = req.params;

    const challenge = await prisma.liveChallenge.findUnique({ where: { id: challengeId } });
    
    if (!challenge || challenge.creatorId !== creatorId) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este reto.' });
    }

    await prisma.liveChallenge.delete({ where: { id: challengeId } });
    res.status(200).json({ message: 'Reto eliminado de tu arsenal 🗑️' });
  } catch (error) {
    console.error('❌ Error eliminando reto:', error);
    res.status(500).json({ error: 'Error al eliminar el reto.' });
  }
};