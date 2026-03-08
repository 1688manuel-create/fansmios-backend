// backend/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); // 🔥 NUEVO: Importamos Prisma para que el guardia pueda consultar la BD

// 🔒 1. Guardia Estricto (Obligatorio tener cuenta)
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Acceso denegado' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

// 🔓 2. Guardia Flexible (Permite visitantes sin cuenta) - ¡NUEVO!
exports.optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    req.user = null; // Es un visitante
    return next();
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Es un usuario logueado
  } catch (error) {
    req.user = null; // Token expirado, pero lo dejamos ver la página como visitante
  }
  next();
};

// ==========================================
// 2. GUARDIA DE CREADOR (Solo Creator y Admin)
// ==========================================
exports.isCreator = (req, res, next) => {
  if (req.user.role === 'CREATOR' || req.user.role === 'ADMIN') {
    next(); 
  } else {
    return res.status(403).json({ error: 'Acceso denegado. Esta función es solo para Creadores.' });
  }
};

// ==========================================
// 3. GUARDIA DE ADMIN (Acceso Total y Exclusivo)
// ==========================================
exports.isAdmin = (req, res, next) => {
  if (req.user.role === 'ADMIN') {
    next(); 
  } else {
    return res.status(403).json({ error: 'Acceso denegado. Privilegios de Administrador requeridos.' });
  }
};