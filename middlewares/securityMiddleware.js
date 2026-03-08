// backend/middlewares/securityMiddleware.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. FILTRO AUTOMÁTICO DE PALABRAS PROHIBIDAS
// ==========================================
exports.contentFilter = (req, res, next) => {
  const { content } = req.body;
  if (!content) return next();

  // Diccionario de palabras prohibidas (Puedes agregar más)
  const bannedWords = ['estafa', 'fraude', 'hack', 'gratis100%', 'cp', 'violencia'];
  
  const contentLower = content.toLowerCase();
  const containsBadWord = bannedWords.some(word => contentLower.includes(word));

  if (containsBadWord) {
    return res.status(403).json({ error: 'Tu mensaje contiene lenguaje prohibido por la política de seguridad. 🛑' });
  }

  next(); // Si está limpio, lo dejamos pasar al controlador
};

// ==========================================
// 2. DETECCIÓN DE SPAM (Límite de velocidad)
// ==========================================
exports.spamDetector = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const tenSecondsAgo = new Date(Date.now() - 10000); // Hace 10 segundos

    // Revisamos si mandó un mensaje en los últimos 10 segundos
    const recentMessages = await prisma.message.count({
      where: { senderId: userId, createdAt: { gte: tenSecondsAgo } }
    });

    if (recentMessages >= 3) {
      return res.status(429).json({ error: 'Estás enviando mensajes demasiado rápido. Espera un momento (Anti-Spam). 🤖' });
    }

    next();
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. DETECCIÓN DE FRAUDE (Pagos Sospechosos)
// ==========================================
exports.fraudDetector = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { amount, price } = req.body;
    const transactionAmount = amount || price || 0;

    // REGLA 1: Montos irracionalmente altos para una sola transacción
    if (transactionAmount > 10000) {
      return res.status(403).json({ error: 'Transacción bloqueada por seguridad. Monto excede el límite permitido. 🛑' });
    }

    // REGLA 2: Muchas compras en menos de 5 minutos (Posible tarjeta robada)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60000);
    const recentPurchases = await prisma.transaction.count({
      where: { senderId: userId, createdAt: { gte: fiveMinutesAgo } }
    });

    if (recentPurchases >= 5) {
      return res.status(429).json({ error: 'Múltiples transacciones detectadas. Por seguridad de la tarjeta, espera 5 minutos. 💳' });
    }

    next();
  } catch (error) {
    next(error);
  }
};