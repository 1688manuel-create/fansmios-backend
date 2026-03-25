// backend/controllers/messageController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
// 🔥 INYECTAMOS CLOUDINARY Y FS PARA BORRAR LA BASURA LOCAL
const { cloudinary } = require('../utils/cloudinaryConfig');
const fs = require('fs');

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
      const lastMessage = chat.messages;
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
// 🔥 0.1 [MODO DIOS] OBTENER TODAS LAS CONVERSACIONES GLOBALES
// ==========================================
exports.getAllConversationsAdmin = async (req, res) => {
  try {
    // Verificamos estricta seguridad
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Acceso denegado. Requiere Nivel de Administrador." });
    }

    // Extraemos ABSOLUTAMENTE TODOS los chats de la plataforma
    const allConversations = await prisma.conversation.findMany({
      include: {
        creator: { select: { id: true, username: true } },
        fan: { select: { id: true, username: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 } // Solo el último mensaje para la previsualización
      },
      orderBy: { updatedAt: 'desc' }
    });

    const formattedAdminChats = allConversations.map(chat => {
      const lastMessage = chat.messages;
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
// 1. OBTENER HISTORIAL DE UNA CONVERSACIÓN
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
      include: { purchases: { where: { fanId: userId } } }
    });

    const secureMessages = messages.map(msg => {
      const isSender = msg.senderId === userId;
      const isUnlocked = msg.purchases.length > 0 || userRole === 'ADMIN'; 

      if (!msg.isPPV || isSender || isUnlocked) {
        return { ...msg, senderId: isSender ? 'me' : msg.senderId, isUnlocked: true };
      } else {
        // Mantenemos el mediaUrl intacto para que el Frontend pueda aplicarle el filtro borroso
        return { ...msg, senderId: msg.senderId, mediaUrl: msg.mediaUrl, isUnlocked: false };
      }
    });

    res.status(200).json({ messages: secureMessages });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. ENVIAR MENSAJE E INYECTAR NOTIFICACIÓN (CON CLOUDINARY ☁️)
// ==========================================
exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { receiverId, content, isPPV, price, conversationId } = req.body;
    
    if (senderId === receiverId) return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo.' });

    // 🔥 NUEVA LÓGICA DE CLOUDINARY PARA ELIMINAR LA DEPENDENCIA LOCAL
    let mediaUrl = null;
    if (req.file) {
      try {
        // 1. Subimos el archivo a la nube (resource_type 'auto' acepta videos, audios y fotos)
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "fansmio_messages",
          resource_type: "auto" 
        });
        
        // 2. Guardamos la URL segura de la nube
        mediaUrl = result.secure_url;
        
        // 3. Borramos el archivo local temporal para no llenar el disco duro de Coolify
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
        mediaUrl, // 🔥 Ahora guarda el link indestructible de Cloudinary
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

    // 🔥 CORRECCIÓN: Le devolvemos el chatId (activeConvId) al frontend para que sepa dónde está hablando
    res.status(201).json({ 
      message: 'Mensaje enviado ✉️', 
      chatId: activeConvId, 
      messageData: { ...newMessage, senderId: 'me', isUnlocked: true } 
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
    res.status(200).json({ message: 'Bomba lanzada 🚀! Mensaje entregado a tus fans.' });
  } catch (error) {
    res.status(500).json({ error: 'Error al enviar broadcast' });
  }
};