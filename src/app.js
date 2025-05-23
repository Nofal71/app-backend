const express = require('express');
const sharepointRoutes = require('./routes/sharepoint');
const userRoutes = require('./routes/user');

const app = express();
app.use(express.json());
const cors = require('cors');

app.use(cors({
  origin: '*' 
}));

app.use('/api/sharepoint', sharepointRoutes);
app.use('/api/user', userRoutes);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));