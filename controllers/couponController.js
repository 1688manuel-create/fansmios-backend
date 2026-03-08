// backend/controllers/couponController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. CREAR CUPÓN (Solo Creador)
// ==========================================
exports.createCoupon = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { code, discountPercent, maxUses, expiresAt } = req.body;

    if (!code || !discountPercent) return res.status(400).json({ error: 'El código y el porcentaje son obligatorios.' });

    const upperCode = code.toUpperCase().trim().replace(/\s+/g, ''); // Limpiamos espacios
    const existing = await prisma.coupon.findUnique({ where: { code: upperCode } });
    if (existing) return res.status(400).json({ error: 'Ese código ya está en uso en la plataforma.' });

    const coupon = await prisma.coupon.create({
      data: {
        code: upperCode,
        discountPercent: parseFloat(discountPercent),
        creatorId: creatorId,
        maxUses: maxUses ? parseInt(maxUses) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      }
    });

    res.status(201).json({ message: 'Cupón creado con éxito 🎟️', coupon });
  } catch (error) {
    console.error('Error al crear cupón:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. OBTENER MIS CUPONES (Solo Creador)
// ==========================================
exports.getMyCoupons = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const coupons = await prisma.coupon.findMany({
      where: { creatorId: creatorId },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ coupons });
  } catch (error) { res.status(500).json({ error: 'Error interno' }); }
};

// ==========================================
// 3. DESACTIVAR/ACTIVAR CUPÓN (Solo Creador)
// ==========================================
exports.toggleCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const creatorId = req.user.userId;

    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon || coupon.creatorId !== creatorId) return res.status(403).json({ error: 'No autorizado' });

    const updated = await prisma.coupon.update({
      where: { id },
      data: { active: !coupon.active }
    });

    res.status(200).json({ message: updated.active ? 'Cupón Activado ✅' : 'Cupón Desactivado ❌', coupon: updated });
  } catch (error) { res.status(500).json({ error: 'Error interno' }); }
};

// ==========================================
// 4. VALIDAR CUPÓN (Para el Fan antes de pagar)
// ==========================================
exports.validateCoupon = async (req, res) => {
  try {
    const { code, creatorId } = req.body;
    
    if (!code || !creatorId) return res.status(400).json({ error: 'Faltan datos.' });

    const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });

    // Validaciones estrictas
    if (!coupon) return res.status(404).json({ error: 'Cupón no encontrado.' });
    if (coupon.creatorId !== creatorId) return res.status(400).json({ error: 'Este cupón no pertenece a este creador.' });
    if (!coupon.active) return res.status(400).json({ error: 'El cupón está desactivado.' });
    if (coupon.maxUses && coupon.currentUses >= coupon.maxUses) return res.status(400).json({ error: 'El cupón ha alcanzado su límite de uso.' });
    if (coupon.expiresAt && new Date() > new Date(coupon.expiresAt)) return res.status(400).json({ error: 'El cupón ha expirado.' });

    res.status(200).json({ 
      message: '¡Cupón Válido! 🎉', 
      discountPercent: coupon.discountPercent,
      couponId: coupon.id
    });
  } catch (error) { res.status(500).json({ error: 'Error al validar cupón' }); }
};