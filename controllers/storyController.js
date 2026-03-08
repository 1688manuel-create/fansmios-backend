// backend/controllers/storyController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. CREAR HISTORIA
exports.createStory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;
    if (!mediaUrl) return res.status(400).json({ error: 'Debes subir un archivo.' });

    // 🔥 NUEVO: Capturamos el texto que mande el frontend
    const { caption } = req.body; 

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const newStory = await prisma.story.create({
      // 🔥 NUEVO: Lo guardamos en la base de datos
      data: { creatorId: userId, mediaUrl, expiresAt, caption } 
    });
    res.status(201).json({ message: 'Historia creada', story: newStory });
  } catch (error) { res.status(500).json({ error: 'Error al crear historia.' }); }
};

// 2. OBTENER HISTORIAS DEL FEED
exports.getFeedStories = async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = currentUser?.role === 'ADMIN';

    let creatorIds = [];
    if (!isAdmin) {
      const subs = await prisma.subscription.findMany({
        where: { fanId: userId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
        select: { creatorId: true }
      });
      creatorIds = subs.map(s => s.creatorId);
      creatorIds.push(userId); 
    }

    const whereClause = isAdmin 
      ? { expiresAt: { gt: new Date() } } 
      : { creatorId: { in: creatorIds }, expiresAt: { gt: new Date() } };

    const stories = await prisma.story.findMany({
      where: whereClause,
      include: {
        creator: { select: { id: true, username: true, creatorProfile: { select: { profileImage: true } } } },
        _count: { select: { views: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ stories });
  } catch (error) { res.status(500).json({ error: 'Error al obtener historias' }); }
};

// 3. 👻 REGISTRAR VISTA
exports.viewStory = async (req, res) => {
  try {
    const { id } = req.params;
    const viewerId = req.user.userId;

    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Historia no encontrada' });

    if (story.creatorId === viewerId) return res.status(200).json({ message: 'El creador no suma vistas' });

    const currentUser = await prisma.user.findUnique({ where: { id: viewerId }, select: { role: true } });
    if (currentUser?.role === 'ADMIN') return res.status(200).json({ message: 'Visto en modo fantasma 👻' });

    try {
      // 🔥 AQUÍ ESTÁ LA MAGIA: Usamos 'viewer' exactamente como lo pide tu BD
      await prisma.storyView.create({
        data: {
          story: { connect: { id: id } },
          viewer: { connect: { id: viewerId } } 
        }
      });
      console.log(`✅ ¡ÉXITO! Vista guardada para la historia ${id}`);
    } catch (error) {
      if (!error.message.includes('Unique constraint')) {
        console.error("🚨 ERROR AL GUARDAR LA VISTA EN BD:", error.message);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) { 
    res.status(500).json({ error: 'Error interno' }); 
  }
};

// 4. 👁️ OBTENER LISTA DE ESPECTADORES
exports.getStoryViews = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Historia no encontrada' });

    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });

    if (story.creatorId !== userId && currentUser?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // Buscamos las vistas y traemos los datos del 'viewer' (el usuario)
    const views = await prisma.storyView.findMany({ 
      where: { storyId: id },
      include: {
        viewer: { // 🔥 Usamos 'viewer' aquí también
          select: { username: true, creatorProfile: { select: { profileImage: true } } }
        }
      }
    });
    
    // Formateamos para que el Frontend reciba lo que espera
    const formattedViews = views.map(v => ({
      ...v,
      fan: v.viewer || { username: 'Usuario' } 
    }));

    res.status(200).json({ views: formattedViews });
  } catch (error) { 
    console.error("🚨 Error al obtener espectadores:", error);
    res.status(500).json({ error: 'Error interno' }); 
  }
};

// 5. 🗑️ ELIMINAR HISTORIA
exports.deleteStory = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'No encontrada' });
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (story.creatorId !== userId && currentUser?.role !== 'ADMIN') return res.status(403).json({ error: 'Acceso denegado' });
    await prisma.story.delete({ where: { id } });
    res.status(200).json({ message: 'Historia eliminada con éxito 🗑️' });
  } catch (error) { res.status(500).json({ error: 'Error al eliminar' }); }
};