// backend/controllers/statsController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getCreatorStats = async (req, res) => {
  try {
    const creatorId = req.user.userId;

    // 1. Contar Suscriptores Activos (🔥 FIX: Solo usuarios únicos)
    const uniqueActiveSubscribers = await prisma.subscription.findMany({
      where: { creatorId: creatorId, status: 'ACTIVE' },
      distinct: ['userId'], // El escudo anti-clones: agrupa por usuario único
      select: { userId: true } // Solo traemos el ID para que la consulta sea ultra rápida
    });
    
    const activeSubscribers = uniqueActiveSubscribers.length;

    // 2. Traer todos los posts para sumar Likes y Comentarios
    const posts = await prisma.post.findMany({
      where: { userId: creatorId },
      include: {
        _count: { select: { likes: true, comments: true } }
      }
    });

    const totalPosts = posts.length;
    const totalLikes = posts.reduce((acc, post) => acc + post._count.likes, 0);
    const totalComments = posts.reduce((acc, post) => acc + post._count.comments, 0);

    // 3. Contar Vistas de Historias
    const stories = await prisma.story.findMany({
      where: { creatorId: creatorId },
      select: { id: true }
    });
    const storyIds = stories.map(s => s.id);
    
    const totalStoryViews = await prisma.storyView.count({
      where: { storyId: { in: storyIds } }
    });

    // Enviamos el reporte completo
    res.status(200).json({
      stats: {
        activeSubscribers,
        totalPosts,
        totalLikes,
        totalComments,
        totalStoryViews
      }
    });

  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ error: 'Error interno al cargar las estadísticas.' });
  }
};