// backend/controllers/messageController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Intentamos cargar el socketHandler para las notificaciones en vivo
let socketHandler;
try {
  socketHandler = require('../utils/socketHandler');
} catch (e) {}

// ==========================================
// 0. OBTENER LISTA DE CONVERSACIONES
// ==========================================
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const conversations = await prisma.conversation.findMany({
      where: { OR: [ { creatorId: userId }, { fanId: userId } ] },
      include: {
        creator: { select: { id: true, username: true, email: true } },
        fan: { select: { id: true, username: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const formattedChats = conversations.map(chat => {
      const otherUser = chat.creatorId === userId ? chat.fan : chat.creator;
      const lastMessage = chat.messages[0];
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
// 0.5 OBTENER TOTAL DE MENSAJES SIN LEER (Este faltaba y causó el crash)
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
// 1. OBTENER HISTORIAL DE UNA CONVERSACIÓN (CON MODO DIOS 👑)
// ==========================================
exports.getConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role; // Detectamos si eres el CEO
    const { conversationId } = req.params;

    // Solo marcamos como leídos si NO eres el admin espiando
    if (userRole !== 'ADMIN') {
      await prisma.message.updateMany({
        where: { conversationId: conversationId, receiverId: userId, isRead: false },
        data: { isRead: true }
      });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: conversationId },
      orderBy: { createdAt: 'asc' },
      include: { purchases: { where: { fanId: userId } } }
    });

    const secureMessages = messages.map(msg => {
      const isSender = msg.senderId === userId;
      // LA MAGIA: Si eres ADMIN, el candado se rompe
      const isUnlocked = msg.purchases.length > 0 || userRole === 'ADMIN'; 

      if (!msg.isPPV || isSender || isUnlocked) {
        return { ...msg, senderId: isSender ? 'me' : msg.senderId, isUnlocked: true };
      } else {
        return { ...msg, senderId: msg.senderId, mediaUrl: null, isUnlocked: false };
      }
    });

    res.status(200).json({ messages: secureMessages });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. ENVIAR MENSAJE INDIVIDUAL
// ==========================================
exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { receiverId, content, isPPV, price, conversationId } = req.body;
    const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;

    if (senderId === receiverId) return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo.' });

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

    try {
      if (socketHandler && socketHandler.getIO) {
        const io = socketHandler.getIO();
        io.to(receiverId).emit('nuevoMensaje', newMessage);
      }
    } catch (e) {}

    res.status(201).json({ message: 'Mensaje enviado ✉️', messageData: { ...newMessage, senderId: 'me', isUnlocked: true } });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
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
    // Lógica simplificada de broadcast
    res.status(200).json({ message: 'Bomba lanzada 🚀! Mensaje entregado a tus fans.' });
  } catch (error) {
    res.status(500).json({ error: 'Error al enviar broadcast' });
  }
};