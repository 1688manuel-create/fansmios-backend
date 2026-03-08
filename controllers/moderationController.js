// backend/controllers/moderationController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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