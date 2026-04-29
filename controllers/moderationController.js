// backend/controllers/moderationController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🔥 NUEVAS MUNICIONES: Importamos el bisturí de video y la herramienta de rutas
const { stripAudioFromVideo } = require('../utils/videoProcessor');
const path = require('path');

// ==========================================
// 1. ENVIAR UN REPORTE (Usuario, Post o Mensaje)
// ==========================================
exports.submitReport = async (req, res) => {
  try {
    const reporterId = req.user.userId;
    // Solo recibiremos uno de estos 3 IDs, dependiendo de qué estén reportando
    const { reportedUserId, postId, messageId, reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Debes incluir una razón para el reporte.' });
    }

    if (!reportedUserId && !postId && !messageId) {
      return res.status(400).json({ error: 'Debes especificar qué estás reportando.' });
    }

    // Guardamos el reporte en la base de datos para que el Admin lo revise
    const newReport = await prisma.report.create({
      data: {
        reporterId,
        reportedUserId: reportedUserId || null,
        postId: postId || null,
        messageId: messageId || null,
        reason
      }
    });

    res.status(201).json({ message: 'Reporte enviado exitosamente. Nuestro equipo de moderación lo revisará. 🛡️', report: newReport });
  } catch (error) {
    console.error('Error al enviar reporte:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 🔇 2. PROTOCOLO DE SILENCIO (Castigo DMCA por Copyright)
// ==========================================
exports.muteCopyrightedVideo = async (req, res) => {
  try {
    const { postId } = req.body; // El ID del post que la disquera reportó

    // 1. Buscamos el post en la base de datos
    const post = await prisma.post.findUnique({ where: { id: postId } });
    
    if (!post || !post.mediaUrl) {
      return res.status(404).json({ error: 'Post o video no encontrado.' });
    }

    // 2. Buscamos el archivo físico en tu servidor
    // Extraemos solo el nombre del archivo de la URL
    const fileName = post.mediaUrl.split('/').pop(); 
    // Apuntamos a la carpeta 'uploads' donde viven los archivos
    const filePath = path.join(__dirname, '..', 'uploads', fileName);

    // 3. Ejecutamos el Bisturí de Audio (FFmpeg)
    await stripAudioFromVideo(filePath);

    // 4. Marcamos en la base de datos que este video fue silenciado por DMCA
    // IMPORTANTE: Asegúrate de tener el campo isMutedByAdmin (Booleano, default: false) en tu modelo de Prisma 'Post'
    await prisma.post.update({
      where: { id: postId },
      data: { isMutedByAdmin: true } 
    });

    // Opcional: Aquí podrías disparar una notificación automática al creador en el futuro.

    res.status(200).json({ message: '💥 Audio neutralizado con éxito. El video ahora es mudo pero sigue visible.' });

  } catch (error) {
    console.error('🚨 Error en Protocolo de Silencio:', error);
    res.status(500).json({ error: 'Fallo al intentar silenciar el video.' });
  }
};