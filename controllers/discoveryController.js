// backend/controllers/discoveryController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. BÚSQUEDA Y FILTROS (Por Username o Categoría)
// ==========================================
exports.searchCreators = async (req, res) => {
  try {
    // Recibimos "q" (que puede ser el nombre o el username) y "category"
    const { q, category } = req.query;

    // Empezamos buscando a todos los que sean Creadores
    let whereClause = { role: 'CREATOR' };

    // Si el usuario escribió algo en el buscador
    if (q) {
      whereClause.OR = [
        { username: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } }
      ];
    }

    // Si además seleccionó un filtro de categoría (Ej: "Gaming")
    if (category) {
      whereClause.creatorProfile = { category: category };
    }

    const creators = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        username: true,
        name: true,
        creatorProfile: { select: { profileImage: true, bio: true, category: true, monthlyPrice: true } },
        _count: { select: { followers: true } }
      }
    });

    res.status(200).json({ message: 'Resultados de búsqueda obtenidos exitosamente.', creators });
  } catch (error) {
    console.error('Error al buscar creadores:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar la búsqueda.' });
  }
};

// ==========================================
// 2. TRENDING CREATORS (Algoritmo de Popularidad)
// ==========================================
exports.getTrendingCreators = async (req, res) => {
  try {
    // Buscamos a los creadores ordenados por quién tiene más seguidores (Followers)
    const trending = await prisma.user.findMany({
      where: { role: 'CREATOR' },
      orderBy: { followers: { _count: 'desc' } }, // Ordenar por cuenta de seguidores
      take: 10, // Top 10
      select: {
        id: true,
        username: true,
        name: true,
        creatorProfile: { select: { profileImage: true, coverImage: true, category: true, bio: true, monthlyPrice: true } },
        _count: { select: { followers: true } }
      }
    });

    res.status(200).json({ message: 'Creadores destacados obtenidos exitosamente.', trending });
  } catch (error) {
    console.error('Error al obtener trending:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar las tendencias.' });
  }
};

// ==========================================
// 3. SEGUIR / DEJAR DE SEGUIR (Follow sin suscripción)
// ==========================================
exports.toggleFollow = async (req, res) => {
  try {
    const followerId = req.user.userId;
    const { creatorId } = req.body;

    if (followerId === creatorId) return res.status(400).json({ error: 'Operación no válida: No puedes seguirte a ti mismo.' });

    // Verificamos si ya lo sigue
    const existingFollow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: followerId, followingId: creatorId } }
    });

    if (existingFollow) {
      // Si ya lo sigue, lo dejamos de seguir (Unfollow)
      await prisma.follow.delete({ where: { id: existingFollow.id } });
      return res.status(200).json({ message: 'Has dejado de seguir a este creador.' });
    } else {
      // Si no lo sigue, lo empezamos a seguir (Follow)
      await prisma.follow.create({
        data: { followerId: followerId, followingId: creatorId }
      });
      return res.status(201).json({ message: 'Has comenzado a seguir a este creador exitosamente.' });
    }
  } catch (error) {
    console.error('Error en follow:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar el seguimiento.' });
  }
};

// ==========================================
// 4. GUARDAR EN FAVORITOS (Bookmarks)
// ==========================================
exports.toggleBookmark = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { postId } = req.body;

    const existingBookmark = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId: userId, postId: postId } }
    });

    if (existingBookmark) {
      await prisma.bookmark.delete({ where: { id: existingBookmark.id } });
      return res.status(200).json({ message: 'Publicación eliminada de tus elementos guardados.' });
    } else {
      await prisma.bookmark.create({ data: { userId: userId, postId: postId } });
      return res.status(201).json({ message: 'Publicación guardada exitosamente.' });
    }
  } catch (error) {
    console.error('Error en favoritos:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar el guardado.' });
  }
};

// ==========================================
// 5. VER MI LISTA DE FAVORITOS
// ==========================================
exports.getMyBookmarks = async (req, res) => {
  try {
    const userId = req.user.userId;

    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: userId },
      include: {
        post: { 
          select: { id: true, content: true, mediaUrl: true, mediaType: true, user: { select: { username: true } } } 
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ message: 'Elementos guardados obtenidos exitosamente.', bookmarks });
  } catch (error) {
    console.error('Error al obtener favoritos:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar la solicitud.' });
  }
};