// backend/controllers/adminSettingsController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Obtener los mensajes guardados
exports.getWelcomeMessages = async (req, res) => {
  try {
    const creatorMsg = await prisma.systemSetting.findUnique({ where: { key: 'WELCOME_CREATOR' } });
    const fanMsg = await prisma.systemSetting.findUnique({ where: { key: 'WELCOME_FAN' } });

    res.status(200).json({
      creatorMessage: creatorMsg ? creatorMsg.value : "¡Bienvenido a FansMio, Creador! ⚡",
      fanMessage: fanMsg ? fanMsg.value : "¡Bienvenido a FansMio, Fan! ⚡"
    });
  } catch (error) {
    console.error("Error obteniendo configuraciones:", error);
    res.status(500).json({ error: "Error al cargar los mensajes" });
  }
};

// Guardar los nuevos mensajes (Upsert: Actualiza si existe, Crea si no existe)
exports.updateWelcomeMessages = async (req, res) => {
  try {
    const { creatorMessage, fanMessage } = req.body;

    await prisma.systemSetting.upsert({
      where: { key: 'WELCOME_CREATOR' },
      update: { value: creatorMessage },
      create: { key: 'WELCOME_CREATOR', value: creatorMessage }
    });

    await prisma.systemSetting.upsert({
      where: { key: 'WELCOME_FAN' },
      update: { value: fanMessage },
      create: { key: 'WELCOME_FAN', value: fanMessage }
    });

    res.status(200).json({ message: "¡Mensajes actualizados con éxito en la base de datos!" });
  } catch (error) {
    console.error("Error guardando configuraciones:", error);
    res.status(500).json({ error: "Error crítico al guardar en la base de datos." });
  }
};