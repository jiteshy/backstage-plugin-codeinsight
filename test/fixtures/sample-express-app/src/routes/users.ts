import { Router } from 'express';

import { UserController } from '../controllers/UserController';
import { UserService } from '../services/UserService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const userService = new UserService(null as any);
const controller = new UserController(userService);

const router = Router();

router.get('/', controller.list.bind(controller));
router.get('/:id', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.delete('/:id', controller.delete.bind(controller));

export { router as userRouter };
