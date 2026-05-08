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
// 2. CREADOR (Y ADMIN): Editar Perfil Público
// ==========================================
exports.updateProfile = async (req, res) => {
  try {
    const { 
      username, name, bio, monthlyPrice, category, welcomeMessage, 
      hideStats, blockedCountries, instagram, twitter, website,
      targetUserId: bodyTargetUserId,
      profileImageBase64, coverImageBase64 
    } = req.body;

    const targetUserId = (req.user.role === 'ADMIN' && bodyTargetUserId) 
                          ? bodyTargetUserId 
                          : req.user.userId;

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

    // 2. PREPARAR DATOS DEL PERFIL
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

    // 3. PROCESAMIENTO DE IMÁGENES BASE64
    if (profileImageBase64) {
      const result = await cloudinary.uploader.upload(profileImageBase64, { 
        folder: "fansmio_profiles",
        resource_type: "auto"
      });
      profileData.profileImage = result.secure_url;
    }

    if (coverImageBase64) {
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
// 4. OBTENER PERFIL DEL USUARIO
// ==========================================
exports.getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { 
        creatorProfile: true,
        wallet: true 
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!user.creatorProfile) {
      user.creatorProfile = {
        bio: "", monthlyPrice: 0, category: "General", welcomeMessage: "",
        hideStats: false, blockedCountries: "", instagram: "", twitter: "",
        website: "", profileImage: null, coverImage: null
      };
    }

    user.walletBalance = user.wallet?.balance || 0;

    res.status(200).json({ user });
  } catch (error) {
    console.error('🚨 Error obteniendo perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 5. SEGUIR / DEJAR DE SEGUIR A UN USUARIO
// ==========================================
exports.toggleFollow = async (req, res) => {
  try {
    const followerId = req.user.userId;
    const followingId = req.params.id;

    if (followerId === followingId) {
      return res.status(400).json({ error: "No puedes seguirte a ti mismo" });
    }

    const existingFollow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId } }
    });

    if (existingFollow) {
      await prisma.follow.delete({ where: { id: existingFollow.id } });
      return res.status(200).json({ message: "Has dejado de seguir a este creador", isFollowing: false });
    } else {
      await prisma.follow.create({ data: { followerId, followingId } });
      return res.status(200).json({ message: "Ahora sigues a este creador", isFollowing: true });
    }
  } catch (error) {
    console.error('Error en toggleFollow:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ==========================================
// ACTUALIZAR EMAIL, CONTRASEÑA, NOTIFICACIONES
// ==========================================
exports.updateEmail = async (req, res) => {
  try {
    const { newEmail } = req.body;
    const userId = req.user.userId;
    if (!newEmail) return res.status(400).json({ error: 'Debes proporcionar un nuevo email.' });
    const existingUser = await prisma.user.findUnique({ where: { email: newEmail } });
    if (existingUser) return res.status(400).json({ error: 'Este correo ya está en uso por otra cuenta.' });
    const updatedUser = await prisma.user.update({ where: { id: userId }, data: { email: newEmail } });
    res.status(200).json({ message: '✅ Email actualizado correctamente.', user: { email: updatedUser.email } });
  } catch (error) {
    res.status(500).json({ error: 'Error interno al actualizar el email.' });
  }
};

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
    await prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });
    res.status(200).json({ message: '✅ Contraseña actualizada correctamente.' });
  } catch (error) {
    res.status(500).json({ error: 'Error interno al actualizar la contraseña.' });
  }
};

exports.updateNotificationSettings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { emailPromotions, emailNewMessages, emailSales } = req.body;
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { emailPromotions, emailNewMessages, emailSales }
    });
    res.status(200).json({ message: '✅ Preferencias guardadas.', user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: 'Error interno.' });
  }
};

exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const notifications = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const unreadCount = await prisma.notification.count({ where: { userId, isRead: false } });
    res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar notificaciones.' });
  }
};

exports.markNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    res.status(200).json({ message: 'Todas leídas ✅' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar.' });
  }
};

exports.savePushToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'Falta el token' });
    await prisma.user.update({ where: { id: userId }, data: { fcmToken } });
    res.status(200).json({ message: '✅ Dispositivo vinculado.' });
  } catch (error) {
    res.status(500).json({ error: 'Error interno.' });
  }
};

// ==========================================
// 🔥 OBTENER CREADORES EN TENDENCIA (AHORA CON FUEGO Y LEYENDA)
// ==========================================
exports.getTrendingCreators = async (req, res) => {
  try {
    const promotedCreators = await prisma.promotion.findMany({
      where: {
        active: true,
        expiresAt: { gt: new Date() }, 
        // 🔥 INYECTAMOS 'LEGEND' PARA QUE SALGAN EN EL CARRUSEL
        package: { in: ['BASIC', 'PRO', 'LEGEND'] } 
      },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
            // 🔥 EXTRAEMOS EL DATO DEL FUEGO DESDE LA BASE DE DATOS
            hasFireBorder: true, 
            creatorProfile: {
              select: {
                profileImage: true
              }
            }
          }
        }
      },
      orderBy: {
        package: 'desc' 
      },
      take: 5 
    });

    let formattedTrending = promotedCreators.map(promo => ({
      id: promo.creator.id,
      username: promo.creator.username,
      name: promo.creator.name || promo.creator.username, 
      isOnline: Math.random() > 0.5, 
      creatorProfile: promo.creator.creatorProfile,
      isPromoted: true,
      // 🔥 LE PASAMOS EL FUEGO AL FRONTEND
      hasFireBorder: promo.creator.hasFireBorder || false 
    }));

    if (formattedTrending.length < 5) {
      const excludeIds = formattedTrending.map(c => c.id);
      
      const fillerCreators = await prisma.user.findMany({
        where: {
          role: { in: ['CREATOR', 'ADMIN'] },
          id: { notIn: excludeIds }
        },
        take: 5 - formattedTrending.length,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, username: true, name: true, role: true,
          // 🔥 TAMBIÉN REVISAMOS SI LOS DE RELLENO TIENEN FUEGO
          hasFireBorder: true, 
          creatorProfile: { select: { profileImage: true } }
        }
      });

      const formattedFillers = fillerCreators.map(creator => ({
        id: creator.id,
        username: creator.username,
        name: creator.name || creator.username,
        isOnline: Math.random() > 0.5,
        creatorProfile: creator.creatorProfile,
        isPromoted: false,
        // 🔥 LE PASAMOS EL FUEGO AL FRONTEND
        hasFireBorder: creator.hasFireBorder || false 
      }));

      formattedTrending = [...formattedTrending, ...formattedFillers];
    }

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
            // 🔥 POR SI ACASO EL DIOS TAMBIÉN COMPRÓ FUEGO
            hasFireBorder: true,
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

exports.blockUser = async (req, res) => {
  try {
    const { id: targetUserId } = req.params; 
    const blockerId = req.user.userId;      

    if (targetUserId === blockerId) {
      return res.status(400).json({ error: "No puedes bloquearte a ti mismo." });
    }

    await prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId: targetUserId } },
      update: {},
      create: { blockerId, blockedId: targetUserId }
    });

    await prisma.comment.deleteMany({
      where: { userId: targetUserId, post: { userId: blockerId } }
    });

    await prisma.subscription.deleteMany({
      where: {
        OR: [
          { creatorId: blockerId, fanId: targetUserId },
          { creatorId: targetUserId, fanId: blockerId }
        ]
      }
    });

    res.status(200).json({ message: "Usuario bloqueado y rastro eliminado con éxito. 🚫" });

  } catch (error) {
    console.error("🚨 Error en el protocolo de bloqueo:", error);
    res.status(500).json({ error: "Fallo interno al procesar el bloqueo." });
  }
};