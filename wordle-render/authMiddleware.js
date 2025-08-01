const { admin } = require('./lib/firebase');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.uid = decodedToken.uid;  // UID de Firebase
      return next();
    } catch (error) {
      console.error('Error verificando token:', error);
      return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
    }
  }

  // Sin token → fallback para Alexa
  req.uid = req.query.userId || req.body.userId;
  req.isAlexa = true;
  next();
}

module.exports = authMiddleware;
