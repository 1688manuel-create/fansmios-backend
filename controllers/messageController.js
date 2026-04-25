const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { cloudinary } = require('../utils/cloudinaryConfig');
const fs = require('fs');

let socketHandler;
try {
  socketHandler = require('../utils/socketHandler');
} catch (e) {}

// ==========================================
// 0. OBTENER LISTA DE CONVERSACIONES (Con fotos)
// ==========================================
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const conversations = await prisma.conversation.findMany({
      where: { OR: [ { creatorId: userId }, { fanId: userId } ] },
      include: {
        // 🔥 CORRECCIÓN: Ahora traemos creatorProfile para AMBOS (Creador y Fan)
        creator: { select: { id: true, username: true, email: true, creatorProfile: { select: { profileImage: true } } } },
        fan: { select: { id: true, username: true, email: true, creatorProfile: { select: { profileImage: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const formattedChats = conversations.map(chat => {
      const otherUser = chat.creatorId === userId ? chat.fan : chat.creator;
      const lastMessage = chat.messages ? chat.messages : null; // Corrección: Extraer el primer elemento del array
      const isUnread = lastMessage ? (lastMessage.receiverId === userId && !lastMessage.isRead) : false;

      return {
        id: chat.id,
        user: otherUser,
        lastMsg: lastMessage ? (lastMessage.isPPV ? '🔒 Mensaje privado' : lastMessage.content || '📷 Archivo') : 'Inicia la conversación',
        time: lastMessage ? new Date(lastMessage.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '',
        unread: isUnread 
      };
    });

    res.status(200).json({ conversations: formattedChats });
  } catch (error) {
    res.status(500).json({ error: "Error interno al cargar chats" });
  }
};

// ==========================================
// 0.1 [MODO DIOS] OBTENER TODAS LAS CONVERSACIONES GLOBALES
// ==========================================
exports.getAllConversationsAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Acceso denegado. Requiere Nivel de Administrador." });
    }

    const allConversations = await prisma.conversation.findMany({
      include: {
        creator: { select: { id: true, username: true, creatorProfile: { select: { profileImage: true } } } },
        fan: { select: { id: true, username: true, creatorProfile: { select: { profileImage: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const formattedAdminChats = allConversations.map(chat => {
      const lastMessage = chat.messages ? chat.messages : null;
      return {
        id: chat.id,
        creator: chat.creator,
        fan: chat.fan,
        lastMsg: lastMessage ? (lastMessage.isPPV ? '🔒 [PPV]' : lastMessage.content || '📷 [Archivo]') : 'Chat vacío',
        time: lastMessage?.createdAt ? new Date(lastMessage.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''
      };
    });

    res.status(200).json({ conversations: formattedAdminChats });
  } catch (error) {
    console.error("Error en Modo Dios:", error);
    res.status(500).json({ error: "Fallo crítico al extraer la base de datos de chats." });
  }
};

// ==========================================
// 0.5 OBTENER TOTAL DE MENSAJES SIN LEER
// ==========================================
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.userId;
    const count = await prisma.message.count({ where: { receiverId: userId, isRead: false } });
    res.status(200).json({ unreadCount: count });
  } catch (error) { 
    res.status(500).json({ error: "Error contando mensajes" }); 
  }
};

// ==========================================
// 1. OBTENER HISTORIAL DE UNA CONVERSACIÓN (Inyecta fotos a cada burbuja)
// ==========================================
exports.getConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role; 
    const { conversationId } = req.params;

    if (userRole !== 'ADMIN') {
      await prisma.message.updateMany({
        where: { conversationId: conversationId, receiverId: userId, isRead: false },
        data: { isRead: true }
      });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: conversationId },
      orderBy: { createdAt: 'asc' },
      include: { 
        purchases: { where: { fanId: userId } },
        // 🔥 CORRECCIÓN: Traemos la foto individual del remitente para cada mensaje
        sender: { select: { id: true, username: true, creatorProfile: { select: { profileImage: true } } } }
      }
    });

    const secureMessages = messages.map(msg => {
      const isSender = msg.senderId === userId;
      const isUnlocked = msg.purchases.length > 0 || userRole === 'ADMIN'; 
      // 🔥 Extraemos la foto y se la inyectamos a la respuesta
      const profileImage = msg.sender?.creatorProfile?.profileImage || null;

      if (!msg.isPPV || isSender || isUnlocked) {
        return { ...msg, senderId: isSender ? 'me' : msg.senderId, isUnlocked: true, profileImage };
      } else {
        return { ...msg, senderId: msg.senderId, mediaUrl: msg.mediaUrl, isUnlocked: false, profileImage };
      }
    });

    res.status(200).json({ messages: secureMessages });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. ENVIAR MENSAJE E INYECTAR NOTIFICACIÓN
// ==========================================
exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { receiverId, content, isPPV, price, conversationId } = req.body;
    
    if (senderId === receiverId) return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo.' });

    let mediaUrl = null;
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "fansmio_messages",
          resource_type: "auto" 
        });
        mediaUrl = result.secure_url;
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (uploadError) {
        console.error("🚨 Error subiendo archivo a Cloudinary:", uploadError);
        return res.status(500).json({ error: 'Fallo al subir el archivo multimedia a la nube.' });
      }
    }

    const isBlocked = await prisma.block.findFirst({
      where: { OR: [ { blockerId: senderId, blockedId: receiverId }, { blockerId: receiverId, blockedId: senderId } ] }
    });
    if (isBlocked) return res.status(403).json({ error: 'Hay un bloqueo activo 🚫.' });

    const isPpvBool = isPPV === 'true' || isPPV === true;
    if (isPpvBool && (!price || parseFloat(price) <= 0)) {
      return res.status(400).json({ error: 'Un mensaje PPV debe tener precio mayor a $0' });
    }

    let activeConvId = conversationId;
    if (!activeConvId || activeConvId === 'undefined') {
       const existingConv = await prisma.conversation.findFirst({
          where: { OR: [ { creatorId: senderId, fanId: receiverId }, { creatorId: receiverId, fanId: senderId } ] }
       });
       if (existingConv) {
         activeConvId = existingConv.id;
       } else {
         const role = req.user.role;
         const newConv = await prisma.conversation.create({
            data: { creatorId: role === 'CREATOR' ? senderId : receiverId, fanId: role === 'CREATOR' ? receiverId : senderId }
         });
         activeConvId = newConv.id;
       }
    }

    const newMessage = await prisma.message.create({
      data: {
        conversationId: activeConvId,
        senderId, receiverId, 
        content: content || null, 
        mediaUrl,
        isPPV: isPpvBool, 
        price: isPpvBool ? parseFloat(price) : 0.0
      }
    });

    await prisma.conversation.update({
      where: { id: activeConvId },
      data: { updatedAt: new Date() }
    });

    const senderInfo = await prisma.user.findUnique({
      where: { id: senderId }, select: { username: true }
    });

    await prisma.notification.create({
      data: {
        userId: receiverId, 
        type: 'MESSAGE',
        content: `Tienes un nuevo mensaje de @${senderInfo?.username || 'Usuario'}. 💬`,
        link: '/dashboard/messages' 
      }
    });

    try {
      if (socketHandler && socketHandler.getIO) {
        const io = socketHandler.getIO();
        io.to(receiverId).emit('nuevoMensaje', newMessage);
      }
    } catch (e) {}

    // Obtenemos la foto del usuario que acaba de enviar el mensaje para devolvérsela al Frontend de inmediato
    const senderProfile = await prisma.creatorProfile.findUnique({ where: { userId: senderId } });

    res.status(201).json({ 
      message: 'Mensaje enviado ✉️', 
      chatId: activeConvId, 
      messageData: { ...newMessage, senderId: 'me', isUnlocked: true, profileImage: senderProfile?.profileImage || null } 
    });
  } catch (error) {
    console.error("Error en sendMessage:", error);
    res.status(500).json({ error: 'Error interno del servidor al enviar mensaje.' });
  }
};

// ==========================================
// 3. BLOQUEAR A UN USUARIO
// ==========================================
exports.blockUser = async (req, res) => {
  try {
    const blockerId = req.user.userId;
    const { blockedId } = req.body;
    await prisma.block.create({ data: { blockerId, blockedId } });
    res.status(200).json({ message: 'Usuario bloqueado exitosamente 🚫' });
  } catch (error) { 
    res.status(500).json({ error: 'Error interno del servidor' }); 
  }
};

// ==========================================
// 4. DESBLOQUEAR A UN USUARIO
// ==========================================
exports.unblockUser = async (req, res) => {
  try {
    const blockerId = req.user.userId;
    const { blockedId } = req.body;
    await prisma.block.deleteMany({ where: { blockerId, blockedId } });
    res.status(200).json({ message: 'Usuario desbloqueado 🔓' });
  } catch (error) { 
    res.status(200).json({ message: 'Usuario desbloqueado 🔓' }); 
  }
};

// ==========================================
// 5. VERIFICAR ESTADO DE BLOQUEO
// ==========================================
exports.checkBlockStatus = async (req, res) => {
  try {
    const blockerId = req.user.userId;
    const targetId = req.params.userId;
    const block = await prisma.block.findFirst({ where: { blockerId, blockedId: targetId } });
    res.status(200).json({ isBlocked: !!block });
  } catch (error) { 
    res.status(500).json({ error: 'Error verificando bloqueo.' }); 
  }
};

// ==========================================
// 6. ELIMINAR UN MENSAJE
// ==========================================
exports.deleteMessage = async (req, res) => {
  try {
    await prisma.message.delete({ where: { id: req.params.messageId } });
    res.status(200).json({ message: 'Mensaje eliminado 🗑️' });
  } catch (error) { 
    res.status(500).json({ error: 'Error al eliminar.' }); 
  }
};

// ==========================================
// 7. BROADCAST (MASIVO)
// ==========================================
exports.sendBroadcast = async (req, res) => {
  try {
    const creatorId = req.user?.userId || req.user?.id;
    const { content, price } = req.body;
    
    let mediaUrl = null;
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "fansmio_broadcasts",
          resource_type: "auto" 
        });
        mediaUrl = result.secure_url;
        
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (uploadError) {
        console.error("Error subiendo archivo de broadcast:", uploadError);
        return res.status(500).json({ error: 'Fallo al subir el archivo a la nube.' });
      }
    }

    const followers = await prisma.follow.findMany({
      where: { followingId: creatorId },
      select: { followerId: true }
    });

    if (followers.length === 0) {
      return res.status(400).json({ error: "No tienes fans activos para enviar este mensaje." });
    }

    const isPpvBool = !!price && parseFloat(price) > 0;
    const numPrice = isPpvBool ? parseFloat(price) : 0.0;
    const fanIds = followers.map(f => f.followerId);

    const existingConvs = await prisma.conversation.findMany({
      where: { creatorId: creatorId, fanId: { in: fanIds } },
      select: { id: true, fanId: true }
    });

    const existingFanIds = existingConvs.map(c => c.fanId);
    const fansWithoutConv = fanIds.filter(id => !existingFanIds.includes(id));

    if (fansWithoutConv.length > 0) {
      const convsToCreate = fansWithoutConv.map(fanId => ({
        creatorId: creatorId, fanId: fanId, updatedAt: new Date()
      }));
      await prisma.conversation.createMany({ data: convsToCreate });
    }

    const allConvsForBroadcast = await prisma.conversation.findMany({
      where: { creatorId: creatorId, fanId: { in: fanIds } },
      select: { id: true, fanId: true }
    });

    const messagesToInsert = allConvsForBroadcast.map(conv => ({
      conversationId: conv.id, senderId: creatorId, receiverId: conv.fanId, content: content || null, mediaUrl: mediaUrl, isPPV: isPpvBool, price: numPrice
    }));

    await prisma.message.createMany({ data: messagesToInsert });

    const convIds = allConvsForBroadcast.map(c => c.id);
    await prisma.conversation.updateMany({
      where: { id: { in: convIds } },
      data: { updatedAt: new Date() }
    });

    const creatorInfo = await prisma.user.findUnique({ where: { id: creatorId }, select: { username: true }});
    const notificationsToInsert = fanIds.map(fanId => ({
      userId: fanId, type: 'MESSAGE', content: `Mensaje masivo de @${creatorInfo?.username || 'Creador'} 🚀`, link: '/dashboard/messages'
    }));

    await prisma.notification.createMany({ data: notificationsToInsert });

    try {
      if (socketHandler && socketHandler.getIO) {
        const io = socketHandler.getIO();
        fanIds.forEach(fanId => {
           io.to(fanId).emit('alertaMasiva', { from: creatorInfo?.username });
        });
      }
    } catch (e) { console.log("Socket no disponible para broadcast"); }

    res.status(200).json({ success: true, message: `¡Bomba lanzada 🚀! Mensaje entregado a ${fanIds.length} fans exitosamente.` });
  } catch (error) {
    console.error("🚨 Error crítico en Broadcast:", error);
    res.status(500).json({ error: 'Fallo al procesar el envío masivo.' });
  }
};

// 🔥 ANIQUILAR CONVERSACIÓN COMPLETA
exports.deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.id || req.userId || req.user?.userId || req.user?._id;
    const userRole = req.user?.role || req.role;

    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return res.status(404).json({ error: 'La conversación ya no existe.' });

    const isFan = conversation.fanId === userId;
    const isCreator = conversation.creatorId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isFan && !isCreator && !isAdmin) return res.status(403).json({ error: 'No tienes permiso para destruir este chat.' });

    await prisma.message.deleteMany({ where: { conversationId: conversationId } });
    await prisma.conversation.delete({ where: { id: conversationId } });

    res.status(200).json({ message: '💥 Chat y mensajes aniquilados con éxito.' });
  } catch (error) {
    console.error("Error al destruir la conversación:", error);
    res.status(500).json({ error: 'Error interno al intentar destruir el chat.' });
  }
};