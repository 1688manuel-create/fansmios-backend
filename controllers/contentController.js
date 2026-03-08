// backend/controllers/contentController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. CREAR POST (Multiformato, Visibilidad y Programable) - Solo Creadores
// ==========================================
exports.createPost = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { content, mediaUrl, mediaType, visibility, isPPV, price, scheduledAt } = req.body;

    // 🛡️ Reglas de Negocio
    if (isPPV && (!price || price <= 0)) {
      return res.status(400).json({ error: 'Un post PPV debe tener precio mayor a $0.00' });
    }

    // ⏰ Future Feature: Validar la fecha programada
    let parsedScheduledDate = null;
    if (scheduledAt) {
      parsedScheduledDate = new Date(scheduledAt);
      if (parsedScheduledDate <= new Date()) {
        return res.status(400).json({ error: 'La fecha programada debe ser en el futuro.' });
      }
    }

    const newPost = await prisma.post.create({
      data: { 
        content: content,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || 'TEXT', // 'TEXT', 'IMAGE', 'VIDEO'
        visibility: visibility || 'SUBSCRIBERS_ONLY', // 'PUBLIC', 'SUBSCRIBERS_ONLY'
        isPPV: isPPV || false,
        price: isPPV ? parseFloat(price) : 0.0,
        scheduledAt: parsedScheduledDate,
        userId: userId
      }
    });

    res.status(201).json({ message: 'Post creado exitosamente 🚀', post: newPost });
  } catch (error) {
    console.error('Error al crear post:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. VER EL MURO DE UN CREADOR (Control estricto de acceso)
// ==========================================
exports.getCreatorPosts = async (req, res) => {
  try {
    const viewerId = req.user.userId; // El usuario que está viendo el perfil
    const { creatorId } = req.params; // El perfil del creador que estamos visitando

    const isOwner = viewerId === creatorId;
    const today = new Date();

    // 1. Verificamos si el usuario actual (Fan) tiene una suscripción activa con este creador
    const activeSubscription = await prisma.subscription.findUnique({
      where: { fanId_creatorId: { fanId: viewerId, creatorId: creatorId } }
    });
    const isSubscribed = activeSubscription && activeSubscription.status === 'ACTIVE';

    // 2. Construimos el "Filtro" (Where) para la base de datos
    let whereClause = { userId: creatorId };

    if (!isOwner) {
      // Si no es el dueño, ocultamos los posts programados que aún no llegan a su fecha
      whereClause.OR = [
        { scheduledAt: null },
        { scheduledAt: { lte: today } } // lte = Less than or equal (menor o igual a hoy)
      ];

      if (!isSubscribed) {
        // Si no está suscrito, SOLO le mostramos los posts públicos (Gancho)
        whereClause.visibility = 'PUBLIC';
      }
      // Si está suscrito, Prisma no pone filtro de visibilidad, así que le muestra todos (Public y Subscribers_only)
    }

    // 3. Traemos los posts con sus likes y la validación de si el usuario ya los compró (PPV)
    const posts = await prisma.post.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        purchases: { where: { fanId: viewerId } } // Para saber si ya pagó el PPV
      }
    });

    // 4. Enmascarar contenido PPV no comprado (Igual que hicimos con los mensajes)
    const securePosts = posts.map(post => {
      const isUnlocked = post.purchases.length > 0 || isOwner;
      
      if (post.isPPV && !isUnlocked) {
        return {
          ...post,
          content: "🔒 Contenido Exclusivo. Desbloquéalo para ver.",
          mediaUrl: null // Borramos la URL original para que no la roben
        };
      }
      return post;
    });

    res.status(200).json({ message: 'Muro cargado', posts: securePosts });
  } catch (error) {
    console.error('Error al obtener posts:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. ELIMINAR POST (Dueño del post o Admin)
// ==========================================
exports.deletePost = async (req, res) => {
  try {
    const { postId } = req.params; // Viene en la URL
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Buscamos el post para ver quién es el dueño
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) return res.status(404).json({ error: 'Post no encontrado' });

    // Verificamos si es el dueño o si es el Admin (El Admin tiene poder absoluto)
    if (post.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este post' });
    }

    // Al eliminar el post, Prisma borrará automáticamente todos sus likes y comentarios (onDelete: Cascade)
    await prisma.post.delete({ where: { id: postId } });

    res.status(200).json({ message: 'Post y todas sus interacciones eliminados correctamente 🗑️' });
  } catch (error) {
    console.error('Error al eliminar post:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 3. DAR LIKE / CAMBIAR EMOJI / QUITAR LIKE (Fan y Creador)
// ==========================================
exports.toggleLike = async (req, res) => {
  try {
    const { postId, emoji } = req.body;
    const userId = req.user.userId;

    // 🛡️ SEGURIDAD ESTRICTA: Solo permitimos estos 4 emojis exactos
    const validEmojis = ['❤️‍🔥', '❤️', '🤤', '🫦'];
    if (!validEmojis.includes(emoji)) {
      return res.status(400).json({ error: 'Emoji no permitido. Usa: ❤️‍🔥, ❤️, 🤤, 🫦' });
    }

    // Buscamos si el usuario ya le dio like a este post
    const existingLike = await prisma.like.findUnique({
      where: { userId_postId: { userId, postId } }
    });

    if (existingLike) {
      if (existingLike.emoji === emoji) {
        // Si mandó el mismo emoji que ya tenía, significa que quiere QUITAR el like
        await prisma.like.delete({ where: { id: existingLike.id } });
        return res.status(200).json({ message: 'Like removido' });
      } else {
        // Si mandó un emoji diferente, ACTUALIZAMOS su reacción
        const updatedLike = await prisma.like.update({
          where: { id: existingLike.id },
          data: { emoji: emoji }
        });
        return res.status(200).json({ message: 'Reacción actualizada', like: updatedLike });
      }
    } else {
      // Si no tenía like, CREAMOS uno nuevo
      const newLike = await prisma.like.create({
        data: { userId: userId, postId: postId, emoji: emoji }
      });
      return res.status(201).json({ message: 'Like agregado', like: newLike });
    }
  } catch (error) {
    console.error('Error en el like:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 4. COMENTAR Y RESPONDER ESCALONADO (Fan y Creador)
// ==========================================
exports.addComment = async (req, res) => {
  try {
    const { postId, content, parentId } = req.body;
    const userId = req.user.userId;

    if (!content) return res.status(400).json({ error: 'El comentario no puede estar vacío' });

    // MAGIA ESCALONADA: Si nos envían un "parentId", significa que es una respuesta a otro comentario.
    // Si no lo envían (null o undefined), es un comentario normal directo al post.
    const newComment = await prisma.comment.create({
      data: {
        content: content,
        userId: userId,
        postId: postId,
        parentId: parentId || null 
      }
    });

    res.status(201).json({ message: 'Comentario publicado', comment: newComment });
  } catch (error) {
    console.error('Error al comentar:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 5. ELIMINAR COMENTARIO (Dueño del comentario o Admin)
// ==========================================
exports.deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params; // Viene en la URL
    const userId = req.user.userId;
    const userRole = req.user.role;

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

    // Solo el que escribió el comentario o el Admin pueden borrarlo
    if (comment.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'No tienes permiso para borrar este comentario' });
    }

    // Si borramos un comentario "padre", Prisma borrará automáticamente todas sus respuestas "hijas"
    await prisma.comment.delete({ where: { id: commentId } });

    res.status(200).json({ message: 'Comentario eliminado correctamente 🗑️' });
  } catch (error) {
    console.error('Error al eliminar comentario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};