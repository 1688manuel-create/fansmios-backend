// backend/controllers/userController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs'); 
const { cloudinary } = require('../utils/cloudinaryConfig');

// ==========================================
// 1. FAN: Convertirse en Creador
// ==========================================
exports.becomeCreator = async (req, res) => {
  try {
    const userId = req.user.userId; 

    // 1. Cambiamos su rol en la base de datos a CREATOR
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role: 'CREATOR' }
    });

    // 2. Le creamos su "Perfil Público" vacío para que lo llene después
    await prisma.creatorProfile.create({
      data: {
        userId: userId,
        bio: "¡Hola! Soy un nuevo creador en FansMio.",
        monthlyPrice: 5.00
      }
    });

    res.status(200).json({ 
      message: '¡Felicidades! Ahora eres un Creador 🔵', 
      user: { email: updatedUser.email, role: updatedUser.role } 
    });

  } catch (error) {
    console.error('Error al cambiar de rol:', error);
    res.status(500).json({ error: 'Error interno del servidor o el usuario ya tiene un perfil.' });
  }
};

// ==========================================
// 2. CREADOR (Y ADMIN): Editar Perfil Público (BASE64 + FIX REAL)
// ==========================================
exports.updateProfile = async (req, res) => {
  try {
    // ☢️ EXTRAEMOS LAS IMÁGENES BASE64 DEL PAQUETE
    const { 
      username, name, bio, monthlyPrice, category, welcomeMessage, 
      hideStats, blockedCountries, instagram, twitter, website,
      targetUserId: bodyTargetUserId,
      profileImageBase64, coverImageBase64 
    } = req.body;

    const targetUserId = (req.user.role === 'ADMIN' && bodyTargetUserId) 
                          ? bodyTargetUserId 
                          : req.user.userId;

    console.log("====================================");
    console.log("📥 DATOS RECIBIDOS DESDE EL FRONTEND");
    console.log("🧠 targetUserId a editar:", targetUserId);
    console.log("====================================");

    // 1. ACTUALIZAR TABLA PRINCIPAL (USER)
    const userUpdateData = {};
    if (name !== undefined) userUpdateData.name = name;
    
    if (username) {
      const cleanUsername = username.toLowerCase().replace(/\s+/g, '');
      const existingUser = await prisma.user.findUnique({ where: { username: cleanUsername } });
      if (existingUser && existingUser.id !== targetUserId) {
        return res.status(400).json({ error: 'Ese nombre de usuario ya está ocupado.' });
      }
      userUpdateData.username = cleanUsername;
    }

    if (Object.keys(userUpdateData).length > 0) {
      await prisma.user.update({
        where: { id: targetUserId },
        data: userUpdateData
      });
    }

    // 2. PREPARAR DATOS DEL PERFIL (CONSTRUCCIÓN DINÁMICA)
    const profileData = {};

    if (bio !== undefined) profileData.bio = bio;
    if (monthlyPrice !== undefined) profileData.monthlyPrice = parseFloat(monthlyPrice);
    if (category !== undefined) profileData.category = category;
    if (welcomeMessage !== undefined) profileData.welcomeMessage = welcomeMessage;
    if (hideStats !== undefined) profileData.hideStats = hideStats === 'true' || hideStats === true;
    if (blockedCountries !== undefined) profileData.blockedCountries = blockedCountries;
    if (instagram !== undefined) profileData.instagram = instagram;
    if (twitter !== undefined) profileData.twitter = twitter;
    if (website !== undefined) profileData.website = website;

    // ==========================
    // 3. PROCESAMIENTO DE IMÁGENES BASE64 ☢️
    // ==========================
    if (profileImageBase64) {
      console.log("📸 Procesando Foto de Perfil en texto Base64...");
      const result = await cloudinary.uploader.upload(profileImageBase64, { 
        folder: "fansmio_profiles",
        resource_type: "auto"
      });
      profileData.profileImage = result.secure_url;
    }

    if (coverImageBase64) {
      console.log("🖼️ Procesando Foto de Portada en texto Base64...");
      const result = await cloudinary.uploader.upload(coverImageBase64, { 
        folder: "fansmio_profiles",
        resource_type: "auto"
      });
      profileData.coverImage = result.secure_url;
    }

    // 4. UPSERT BLINDADO
    const updatedProfile = await prisma.creatorProfile.upsert({
      where: { userId: targetUserId },
      update: profileData,
      create: {
        userId: targetUserId,
        ...profileData
      }
    });

    console.log("✅ PERFIL GUARDADO EXITOSAMENTE:", updatedProfile.id);

    res.status(200).json({ message: 'Perfil actualizado exitosamente', profile: updatedProfile });

  } catch (error) {
    console.error('🚨 Error crítico al actualizar perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor al guardar configuraciones' });
  }
};

// ==========================================
// 3. ADMIN: Ver absolutamente todos los usuarios
// ==========================================
exports.getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        creatorProfile: true
      }
    });

    res.status(200).json({ 
      message: '🔴 Acceso Total de Administrador concedido', 
      totalUsers: users.length,
      users: users 
    });

  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 4. OBTENER PERFIL DEL USUARIO (Blindado 🛡️ + Bóveda 💰)
// ==========================================
exports.getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { 
        creatorProfile: true,
        wallet: true // 👈 ¡NUEVO! Le ordenamos a Prisma que traiga la Bóveda
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // 🛡️ ESCUDO ANTI-COLAPSO PARA ADMINS Y NUEVOS
    if (!user.creatorProfile) {
      user.creatorProfile = {
        bio: "",
        monthlyPrice: 0,
        category: "General",
        welcomeMessage: "",
        hideStats: false,
        blockedCountries: "",
        instagram: "",
        twitter: "",
        website: "",
        profileImage: null,
        coverImage: null
      };
    }

    // 💰 ¡NUEVO! Empaquetamos el saldo de la bóveda para que el Frontend lo entienda fácil
    user.walletBalance = user.wallet?.balance || 0;

    res.status(200).json({ user });
  } catch (error) {
    console.error('🚨 Error obteniendo perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 5. SEGUIR / DEJAR DE SEGUIR A UN USUARIO (FOLLOW)
// ==========================================
exports.toggleFollow = async (req, res) => {
  try {
    const followerId = req.user.userId;
    const followingId = req.params.id;

    if (followerId === followingId) {
      return res.status(400).json({ error: "No puedes seguirte a ti mismo" });
    }

    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId }
      }
    });

    if (existingFollow) {
      await prisma.follow.delete({ where: { id: existingFollow.id } });
      return res.status(200).json({ message: "Has dejado de seguir a este creador", isFollowing: false });
    } else {
      await prisma.follow.create({
        data: { followerId, followingId }
      });
      return res.status(200).json({ message: "Ahora sigues a este creador", isFollowing: true });
    }
  } catch (error) {
    console.error('Error en toggleFollow:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ==========================================
// 🔥 NUEVO: ACTUALIZAR EMAIL
// ==========================================
exports.updateEmail = async (req, res) => {
  try {
    const { newEmail } = req.body;
    const userId = req.user.userId;

    if (!newEmail) return res.status(400).json({ error: 'Debes proporcionar un nuevo email.' });

    const existingUser = await prisma.user.findUnique({ where: { email: newEmail } });
    if (existingUser) return res.status(400).json({ error: 'Este correo ya está en uso por otra cuenta.' });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { email: newEmail }
    });

    res.status(200).json({ message: '✅ Email actualizado correctamente.', user: { email: updatedUser.email } });
  } catch (error) {
    console.error("Error al actualizar email:", error);
    res.status(500).json({ error: 'Error interno al actualizar el email.' });
  }
};

// ==========================================
// 🔥 NUEVO: ACTUALIZAR CONTRASEÑA
// ==========================================
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan campos obligatorios.' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: 'La contraseña actual es incorrecta. 🛑' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.status(200).json({ message: '✅ Contraseña actualizada correctamente. (Tu seguridad ha mejorado).' });
  } catch (error) {
    console.error("Error al actualizar contraseña:", error);
    res.status(500).json({ error: 'Error interno al actualizar la contraseña.' });
  }
};

// ==========================================
// 🔥 NUEVO: ACTUALIZAR PREFERENCIAS DE NOTIFICACIONES
// ==========================================
exports.updateNotificationSettings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { emailPromotions, emailNewMessages, emailSales } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        emailPromotions: emailPromotions,
        emailNewMessages: emailNewMessages,
        emailSales: emailSales
      }
    });

    res.status(200).json({ 
      message: '✅ Preferencias de notificaciones guardadas.',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        role: updatedUser.role,
        emailPromotions: updatedUser.emailPromotions,
        emailNewMessages: updatedUser.emailNewMessages,
        emailSales: updatedUser.emailSales
      }
    });
  } catch (error) {
    console.error("Error al guardar notificaciones:", error);
    res.status(500).json({ error: 'Error interno al guardar preferencias.' });
  }
};

// ==========================================
// 🔔 1. OBTENER MIS NOTIFICACIONES (IN-APP)
// ==========================================
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const notifications = await prisma.notification.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50 
    });

    const unreadCount = await prisma.notification.count({
      where: { userId: userId, isRead: false }
    });

    res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    console.error("Error al obtener notificaciones:", error);
    res.status(500).json({ error: 'Error al cargar el centro de notificaciones.' });
  }
};

// ==========================================
// 🔔 2. MARCAR TODAS COMO LEÍDAS
// ==========================================
exports.markNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    await prisma.notification.updateMany({
      where: { userId: userId, isRead: false },
      data: { isRead: true }
    });

    res.status(200).json({ message: 'Todas las notificaciones marcadas como leídas ✅' });
  } catch (error) {
    console.error("Error al marcar como leídas:", error);
    res.status(500).json({ error: 'Error al actualizar notificaciones.' });
  }
};

// ==========================================
// 📱 GUARDAR TOKEN PUSH (FIREBASE)
// ==========================================
exports.savePushToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fcmToken } = req.body;

    if (!fcmToken) return res.status(400).json({ error: 'Falta el token' });

    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken: fcmToken }
    });

    res.status(200).json({ message: '✅ Dispositivo vinculado para notificaciones Push.' });
  } catch (error) {
    console.error("Error al guardar token Push:", error);
    res.status(500).json({ error: 'Error interno.' });
  }
};

// ==========================================
// OBTENER CREADORES EN TENDENCIA (TRENDING VIP)
// ==========================================
exports.getTrendingCreators = async (req, res) => {
  try {
    const trendingCreators = await prisma.user.findMany({
      where: {
        role: { in: ['CREATOR', 'ADMIN'] }
      },
      take: 5, 
      orderBy: {
        createdAt: 'desc' 
      },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        creatorProfile: {
          select: {
            profileImage: true
          }
        }
      }
    });

    const formattedTrending = trendingCreators.map(creator => ({
      id: creator.id,
      username: creator.username,
      name: creator.name || creator.username, 
      isOnline: Math.random() > 0.5, 
      creatorProfile: creator.creatorProfile
    }));

    res.status(200).json({ trending: formattedTrending });
  } catch (error) {
    console.error('Error al obtener Trending VIP:', error);
    res.status(500).json({ error: 'Error interno al cargar la barra VIP' });
  }
};

// OBTENER AL CREADOR CON EL BOOST NIVEL DIOS (HISTORIA DORADA)
exports.getVipCreator = async (req, res) => {
  try {
    const activeGodPromo = await prisma.promotion.findFirst({
      where: {
        package: 'GOD',
        active: true,
        expiresAt: { gt: new Date() } 
      },
      orderBy: { createdAt: 'desc' }, 
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            creatorProfile: { select: { profileImage: true } }
          }
        }
      }
    });

    res.status(200).json({ vip: activeGodPromo ? activeGodPromo.creator : null });
  } catch (error) {
    console.error('Error fetching VIP Creator:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};