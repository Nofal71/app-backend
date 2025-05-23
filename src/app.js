require('dotenv').config();

const express = require('express');
const cors = require('cors');

const sharepointRoutes = require('./routes/sharepoint');
const userRoutes = require('./routes/user');

const app = express();

app.use(express.json());
app.use(cors({ origin: '*' }));

app.use('/api/sharepoint', sharepointRoutes);
app.use('/api/user', userRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
