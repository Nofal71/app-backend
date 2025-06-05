const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    const decoded = jwt.decode(token);

    if (!decoded || !decoded.tid) {
      return res.status(400).json({ error: 'Unable to extract tenant ID from token.' });
    }

    req.accessToken = token;         
    req.tenantId = decoded.tid;      

    next();
  } catch (err) {
    return res.status(400).json({ error: 'Invalid token format.' });
  }
};

module.exports = { authMiddleware };
