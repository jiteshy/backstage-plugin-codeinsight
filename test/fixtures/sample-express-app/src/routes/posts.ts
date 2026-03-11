import { Router } from 'express';

import { PostController } from '../controllers/PostController';
import { PostService } from '../services/PostService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postService = new PostService(null as any);
const controller = new PostController(postService);

const router = Router();

router.get('/', controller.list.bind(controller));
router.get('/:id', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.patch('/:id/publish', controller.publish.bind(controller));

export { router as postRouter };
