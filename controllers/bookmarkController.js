// backend/controllers/bookmarkController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. GUARDAR / QUITAR DE FAVORITOS (TOGGLE)
// ==========================================
exports.toggleBookmark = async (req, res) => {
  try {
    const userId = req.user.userId;
    const postId = req.params.postId;

    // Buscamos si el post ya está guardado por este usuario
    const existingBookmark = await prisma.bookmark.findUnique({
      where: {
        userId_postId: { userId, postId }
      }
    });

    if (existingBookmark) {
      // Si ya está guardado, lo quitamos (Unsave)
      await prisma.bookmark.delete({
        where: { id: existingBookmark.id }
      });
      return res.status(200).json({ message: "Post eliminado de favoritos", isBookmarked: false });
    } else {
      // Si no está, lo guardamos (Save)
      await prisma.bookmark.create({
        data: { userId, postId }
      });
      return res.status(200).json({ message: "Post guardado en favoritos", isBookmarked: true });
    }
  } catch (error) {
    console.error('Error en toggleBookmark:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. OBTENER TODOS LOS POSTS GUARDADOS DEL FAN (🛡️ BLINDADO)
// ==========================================
exports.getMyBookmarks = async (req, res) => {
  try {
    const userId = req.user.userId;

    // 🔥 1. Obtenemos el rol del usuario (Los Administradores ven todo)
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });
    const isAdmin = currentUser?.role === 'ADMIN';

    // 🔥 2. Buscamos los guardados, INCLUYENDO las compras y suscripciones del usuario
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' }, 
      include: {
        post: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                creatorProfile: { select: { profileImage: true } },
                subscribers: { where: { fanId: userId } } // Saber si es VIP
              }
            },
            _count: { select: { likes: true, comments: true } },
            purchases: { where: { fanId: userId } } // Saber si compró el PPV
          }
        }
      }
    });

    // 🔥 3. Calculamos el acceso post por post (El cerebro matemático)
    const formattedBookmarks = bookmarks.map(bookmark => {
      const post = bookmark.post;
      if (!post) return bookmark;

      // Por defecto, asumimos que tiene acceso si es Admin, es su propio post, o ya lo compró.
      let hasAccess = isAdmin || post.user.id === userId || post.purchases.length > 0;

      // Si aún no tiene acceso y NO es PPV, revisamos si tiene suscripción VIP
      if (!hasAccess && !post.isPPV) {
        const sub = post.user.subscribers?.find(s => s.fanId === userId);
        if (sub) {
          if (sub.status === 'ACTIVE') {
            hasAccess = true;
          } else if (sub.status === 'PAST_DUE') {
            const gracePeriodMs = 3 * 24 * 60 * 60 * 1000;
            const isWithinGrace = (new Date() - new Date(sub.updatedAt)) < gracePeriodMs;
            hasAccess = isWithinGrace;
          }
        } else {
          hasAccess = true; // Si no es PPV y no hay suscripción, es un post libre
        }
      }

      // Devolvemos el post blindado
      return {
        ...bookmark,
        post: {
          ...post,
          hasAccess, // Le mandamos la orden al candado del Frontend
          content: hasAccess ? post.content : null, // 🛡️ Borramos el texto si no pagó
          mediaUrl: hasAccess ? post.mediaUrl : null // 🛡️ Borramos la imagen si no pagó
        }
      };
    });

    res.status(200).json({ bookmarks: formattedBookmarks });
  } catch (error) {
    console.error('Error obteniendo bookmarks:', error);
    res.status(500).json({ error: 'Error al cargar favoritos' });
  }
};