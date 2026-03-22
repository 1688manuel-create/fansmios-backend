// backend/controllers/liveController.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const muxService = require('../utils/muxService');
const { jwt } = require('@mux/mux-node'); 

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

    // Cerrar stream activo si existe (Evitar transmisiones fantasma)
    const activeStream = await prisma.liveStream.findFirst({
      where: { creatorId, status: { in: ['SCHEDULED', 'LIVE'] } }
    });

    if (activeStream) {
      await prisma.liveStream.update({
        where: { id: activeStream.id },
        data: { status: 'ENDED', endedAt: new Date() }
      });
    }

    // Crear infraestructura en MUX
    const muxData = await muxService.createLiveStream(isPPV);

    const newStream = await prisma.liveStream.create({
      data: {
        creatorId,
        title,
        isPPV: isPPV || false,
        price: isPPV ? parseFloat(price) : 0,
        status: 'SCHEDULED',
        streamKey: muxData.streamKey,
        playbackId: muxData.playbackId,
      }
    });

    res.status(201).json({
      message: 'Sala de transmisión creada 🔴',
      liveStream: newStream,
      streamId: newStream.id
    });

  } catch (error) {
    console.error('❌ Error al crear live stream:', error);
    res.status(500).json({ error: 'Error interno al conectar con el servidor de video.' });
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
// 3. OBTENER STREAM (🔥 MODO SIMULACIÓN Y DRM BLINDADO)
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
          include: { user: { select: { username: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50 // Solo mandamos los últimos 50 para no saturar memoria
        }
      }
    });

    if (!stream) {
      return res.status(404).json({ error: 'Transmisión no encontrada o finalizada.' });
    }

    let hasAccess = false;

    // 🛡️ REGLAS DE NEGOCIO Y ACCESO
    if (stream.creator.id === fanId || req.user?.role === 'ADMIN') {
      hasAccess = true; // El creador y el Admin siempre entran gratis
    } else if (stream.isPPV && fanId) {
      const ticket = await prisma.transaction.findFirst({
        where: { senderId: fanId, postId: stream.id, type: 'LIVE_TICKET', status: 'COMPLETED' }
      });
      if (ticket) hasAccess = true;
    } else if (!stream.isPPV && fanId) {
      const isVIP = await prisma.subscription.findFirst({
        where: { fanId, creatorId: stream.creator.id, status: 'ACTIVE' }
      });
      if (isVIP) hasAccess = true;
    }

    // 🔑 FIRMA CRIPTOGRÁFICA (JWT) O SIMULACIÓN
    let playbackToken = null;
    let safePlaybackId = stream.playbackId; // Por defecto mandamos el raw ID

    if (hasAccess && stream.playbackId) {
      // 🔥 PARCHE: Solo intentamos firmar si las variables de entorno existen y jwt está cargado
      if (process.env.MUX_SIGNING_KEY_ID && process.env.MUX_SIGNING_KEY_SECRET && jwt && jwt.signPlaybackId) {
            try {
              playbackToken = jwt.signPlaybackId(stream.playbackId, {
                keyId: process.env.MUX_SIGNING_KEY_ID,
                keySecret: process.env.MUX_SIGNING_KEY_SECRET,
                expiration: '6h', 
              });
              safePlaybackId = stream.playbackId; // 🔥 Dejamos el ID real intacto
            } catch (err) {
          console.error('🚨 Error firmando token Mux:', err.message);
          hasAccess = false; 
        }
      } else {
        console.log('⚠️ [Modo Simulación] Omitiendo firma JWT de MUX porque faltan las llaves reales en .env');
      }
    }

    const responseStream = {
      ...stream,
      streamKey: stream.creator.id === fanId ? stream.streamKey : null,
      messages: hasAccess ? stream.messages.reverse() : [],
      playbackId: hasAccess ? safePlaybackId : null,
      playbackToken: hasAccess ? playbackToken : null
    };

    res.status(200).json({ hasAccess, stream: responseStream });

  } catch (error) {
    console.error('❌ Error al obtener stream:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 4. ENVIAR MENSAJE (💎 CÁLCULO DE ESTATUS VIP)
// ==========================================
exports.sendLiveMessage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { streamId, content, isDonation, amount } = req.body;

    if (!streamId || !content) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // 1. Buscamos de quién es el stream para ver cuánto le ha pagado este fan
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { creatorId: true }
    });

    let fanLevel = 'NEW'; // Nivel por defecto

    if (stream && userId !== stream.creatorId && req.user.role !== 'ADMIN') {
      // 2. Sumamos TODO el dinero que este fan le ha dado al creador (Histórico)
      const historicalSpends = await prisma.transaction.aggregate({
        where: {
          senderId: userId,
          receiverId: stream.creatorId,
          status: 'COMPLETED'
        },
        _sum: { amount: true }
      });

      const totalSpent = historicalSpends._sum.amount || 0;

      // 3. Asignación de Rangos (Gamificación Pura)
      if (totalSpent >= 1000) fanLevel = 'DIAMOND';
      else if (totalSpent >= 500) fanLevel = 'GOLD';
      else if (totalSpent >= 100) fanLevel = 'SILVER';
      else if (totalSpent >= 10) fanLevel = 'BRONZE';
    } else if (userId === stream?.creatorId) {
      fanLevel = 'CREATOR';
    } else if (req.user.role === 'ADMIN') {
      fanLevel = 'ADMIN';
    }

    // 🔥 NUEVO: Movimiento de dinero para la Wallet y el Dashboard
    if (isDonation && parseFloat(amount) > 0) {
      const tipAmount = parseFloat(amount);
      
      // Descontamos al fan y sumamos al creador
      await prisma.user.update({ where: { id: userId }, data: { walletBalance: { decrement: tipAmount } } });
      await prisma.user.update({ where: { id: stream.creatorId }, data: { walletBalance: { increment: tipAmount } } });

      // Creamos la transacción (El Dashboard lee esto para mostrar los ingresos)
      await prisma.transaction.create({
        data: {
          senderId: userId,
          receiverId: stream.creatorId,
          amount: tipAmount,
          type: 'TIP',
          status: 'COMPLETED'
        }
      });
    }

    // 4. Guardamos el mensaje en la BD
    const newMessage = await prisma.liveChatMessage.create({
      data: {
        streamId,
        userId,
        content,
        isDonation: isDonation || false,
        amount: isDonation ? parseFloat(amount) : 0
      },
      include: {
        user: { select: { username: true, role: true } }
      }
    });

    // 5. Devolvemos el mensaje con el nivel de fan adjunto para que el Frontend lo pinte
    const chatMessageWithLevel = {
      ...newMessage,
      fanLevel // Inyectamos el nivel calculado en tiempo real
    };

    res.status(201).json({
      message: 'Mensaje enviado',
      chatMessage: chatMessageWithLevel
    });

  } catch (error) {
    console.error('❌ Error al enviar mensaje:', error);
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
            id: true,
            username: true,
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