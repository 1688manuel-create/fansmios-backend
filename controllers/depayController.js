const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const confirmarDePay = async (req, res) => {
  console.log("🚀 IMPACTO DEPAY RECIBIDO:", req.body);
  
  try {
    const { transactionHash, userId, amount } = req.body;

    if (!transactionHash || !userId || !amount) {
      return res.status(400).json({ error: "Faltan datos del misil" });
    }

    // 1. Opcional pero recomendado: Verificar que el hash no se haya usado antes
    const transaccionExistente = await prisma.transaction.findUnique({
      where: { hash: transactionHash } // Ajusta esto a tu esquema de Prisma
    });

    if (transaccionExistente) {
      return res.status(400).json({ error: "Este recibo ya fue procesado" });
    }

    // 2. Inyectar los fondos al usuario
    // (Ajusta los nombres de las tablas según tu schema.prisma)
    const usuarioActualizado = await prisma.user.update({
      where: { id: userId },
      data: {
        walletBalance: {
          increment: parseFloat(amount)
        }
      }
    });

    // 3. Guardar el recibo para contabilidad
    await prisma.transaction.create({
      data: {
        hash: transactionHash,
        userId: userId,
        amount: parseFloat(amount),
        provider: "DEPAY",
        status: "COMPLETED"
      }
    });

    console.log(`✅ Saldo inyectado. Nuevo balance: ${usuarioActualizado.walletBalance}`);
    return res.status(200).json({ success: true, message: "Fondos inyectados con éxito" });

  } catch (error) {
    console.error("❌ Error en la recarga DePay:", error);
    return res.status(500).json({ error: "Fallo en el servidor interno" });
  }
};

module.exports = { confirmarDePay };