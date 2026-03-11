import express from 'express';

import { authMiddleware } from './middleware/auth';
import { postRouter } from './routes/posts';
import { userRouter } from './routes/users';

const app = express();

app.use(express.json());
app.use('/api/users', authMiddleware, userRouter);
app.use('/api/posts', authMiddleware, postRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;

export function startServer(): void {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
